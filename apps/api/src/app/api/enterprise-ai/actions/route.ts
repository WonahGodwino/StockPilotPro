import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { isActionTrackerAllowedForRole } from '@/lib/enterprise-ai-route-policy'
import { attachActionTracker, createActionTracker, extractActionTracker } from '@/lib/enterprise-ai-action-tracker'

const postSchema = z.object({
  recommendationId: z.string().min(1),
  ownerUserId: z.string().min(1).optional(),
  dueDate: z.string().datetime().optional(),
  expectedImpactScore: z.number().min(-100).max(100).optional(),
  impactNotes: z.string().max(500).optional(),
})

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isActionTrackerAllowedForRole(user.role)) {
      return apiError('Forbidden: action tracker is restricted to admin roles', 403)
    }

    const access = await requireEnterpriseAiAccess(user)
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const ownerUserId = url.searchParams.get('ownerUserId')
    const overdueOnly = url.searchParams.get('overdueOnly') === 'true'
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 30)))

    const rows = await prisma.enterpriseAiRecommendation.findMany({
      where: { tenantId: access.tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(limit * 6, 250),
      select: {
        id: true,
        tenantId: true,
        recommendationType: true,
        title: true,
        summary: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        outputPayload: true,
      },
    })

    const now = Date.now()
    const items = rows
      .map((row) => {
        const tracker = extractActionTracker(row.outputPayload)
        if (!tracker) return null

        if (status && tracker.status !== status) return null
        if (ownerUserId && tracker.ownerUserId !== ownerUserId) return null
        if (overdueOnly) {
          if (!tracker.dueDate) return null
          if (new Date(tracker.dueDate).getTime() >= now) return null
          if (tracker.status === 'DONE' || tracker.status === 'CANCELLED') return null
        }

        return {
          recommendationId: row.id,
          recommendationType: row.recommendationType,
          title: row.title,
          summary: row.summary,
          recommendationStatus: row.status,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          tracker,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .slice(0, limit)

    const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.tracker.status] = (acc[item.tracker.status] || 0) + 1
      return acc
    }, {})

    return NextResponse.json({
      data: {
        tenantId: access.tenantId,
        total: items.length,
        statusCounts,
        items,
      },
    })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ACTIONS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isActionTrackerAllowedForRole(user.role)) {
      return apiError('Forbidden: action tracker is restricted to admin roles', 403)
    }

    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = postSchema.parse(body)

    const recommendation = await prisma.enterpriseAiRecommendation.findFirst({
      where: { id: payload.recommendationId, tenantId: access.tenantId },
    })
    if (!recommendation) return apiError('Recommendation not found', 404)

    const existing = extractActionTracker(recommendation.outputPayload)
    if (existing) return apiError('Action tracker already exists for this recommendation', 409)

    const ownerUserId = payload.ownerUserId || access.userId

    const now = new Date().toISOString()
    const tracker = createActionTracker({
      ownerUserId,
      dueDate: payload.dueDate || null,
      expectedImpactScore: payload.expectedImpactScore ?? null,
      impactNotes: payload.impactNotes || null,
      actorUserId: access.userId,
      nowIso: now,
    })

    const mergedPayload = attachActionTracker(recommendation.outputPayload, tracker)
    const updated = await prisma.enterpriseAiRecommendation.update({
      where: { id: recommendation.id },
      data: {
        outputPayload: toJsonValue(mergedPayload),
      },
    })

    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId: access.tenantId,
        metricKey: 'action_tracker_created',
        metricValue: 1,
        dimensions: {
          recommendationId: recommendation.id,
          recommendationType: recommendation.recommendationType,
          ownerUserId,
        },
      },
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_ACTION_TRACKER_CREATE',
      entity: 'EnterpriseAiRecommendation',
      entityId: recommendation.id,
      newValues: {
        ownerUserId,
        dueDate: payload.dueDate || null,
        expectedImpactScore: payload.expectedImpactScore ?? null,
      },
      req,
    })

    return NextResponse.json({ data: { recommendationId: updated.id, tracker } }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ACTIONS POST]', err)
    return apiError('Internal server error', 500)
  }
}
