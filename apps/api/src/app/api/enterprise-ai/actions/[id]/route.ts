import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { isActionTrackerAllowedForRole } from '@/lib/enterprise-ai-route-policy'
import {
  ActionTrackerStatus,
  attachActionTracker,
  extractActionTracker,
  updateActionTrackerState,
} from '@/lib/enterprise-ai-action-tracker'

const patchSchema = z.object({
  ownerUserId: z.string().min(1).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
  expectedImpactScore: z.number().min(-100).max(100).nullable().optional(),
  realizedImpactScore: z.number().min(-100).max(100).nullable().optional(),
  impactNotes: z.string().max(500).nullable().optional(),
  progressNote: z.string().max(500).nullable().optional(),
})

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function mapRecommendationStatus(status: ActionTrackerStatus | undefined): 'OPEN' | 'RESOLVED' | 'NOT_RELEVANT' | undefined {
  if (!status) return undefined
  if (status === 'DONE') return 'RESOLVED'
  if (status === 'CANCELLED') return 'NOT_RELEVANT'
  return 'OPEN'
}

export async function OPTIONS() {
  return handleOptions()
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!isActionTrackerAllowedForRole(user.role)) {
      return apiError('Forbidden: action tracker is restricted to admin roles', 403)
    }

    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = patchSchema.parse(body)

    const recommendation = await prisma.enterpriseAiRecommendation.findFirst({
      where: { id: params.id, tenantId: access.tenantId },
    })
    if (!recommendation) return apiError('Recommendation not found', 404)

    const currentTracker = extractActionTracker(recommendation.outputPayload)
    if (!currentTracker) return apiError('Action tracker not found for recommendation', 404)

    const now = new Date()
    const nextTracker = updateActionTrackerState({
      current: currentTracker,
      actorUserId: access.userId,
      nowIso: now.toISOString(),
      ownerUserId: payload.ownerUserId,
      dueDate: payload.dueDate,
      status: payload.status,
      expectedImpactScore: payload.expectedImpactScore,
      realizedImpactScore: payload.realizedImpactScore,
      impactNotes: payload.impactNotes,
      progressNote: payload.progressNote,
    })

    const mergedPayload = attachActionTracker(recommendation.outputPayload, nextTracker)
    const mappedRecommendationStatus = mapRecommendationStatus(payload.status)

    const updated = await prisma.enterpriseAiRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: mappedRecommendationStatus,
        actedByUserId: mappedRecommendationStatus ? access.userId : undefined,
        actedAt: mappedRecommendationStatus ? now : undefined,
        outputPayload: toJsonValue(mergedPayload),
      },
    })

    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId: access.tenantId,
        metricKey: 'action_tracker_updated',
        metricValue: 1,
        dimensions: {
          recommendationId: recommendation.id,
          recommendationType: recommendation.recommendationType,
          status: nextTracker.status,
        },
      },
    })

    if (payload.realizedImpactScore !== undefined && payload.realizedImpactScore !== null) {
      await prisma.enterpriseAiMetric.create({
        data: {
          tenantId: access.tenantId,
          metricKey: 'action_tracker_realized_impact_score',
          metricValue: payload.realizedImpactScore,
          dimensions: {
            recommendationId: recommendation.id,
            recommendationType: recommendation.recommendationType,
            status: nextTracker.status,
          },
        },
      })
    }

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_ACTION_TRACKER_UPDATE',
      entity: 'EnterpriseAiRecommendation',
      entityId: recommendation.id,
      newValues: {
        ownerUserId: nextTracker.ownerUserId,
        dueDate: nextTracker.dueDate,
        status: nextTracker.status,
        expectedImpactScore: nextTracker.expectedImpactScore,
        realizedImpactScore: nextTracker.realizedImpactScore,
      },
      req,
    })

    return NextResponse.json({ data: { recommendationId: updated.id, tracker: nextTracker } })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ACTIONS PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
