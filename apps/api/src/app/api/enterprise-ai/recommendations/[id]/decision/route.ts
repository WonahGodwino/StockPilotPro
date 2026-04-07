import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'

const patchSchema = z.object({
  action: z.enum(['accept', 'reject', 'snooze', 'not_relevant', 'resolve']),
  note: z.string().max(500).optional(),
  snoozedUntil: z.string().datetime().optional(),
})

const ACTION_STATUS_MAP = {
  accept: 'ACCEPTED',
  reject: 'REJECTED',
  snooze: 'SNOOZED',
  not_relevant: 'NOT_RELEVANT',
  resolve: 'RESOLVED',
} as const

export async function OPTIONS() {
  return handleOptions()
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = patchSchema.parse(body)

    const recommendation = await prisma.enterpriseAiRecommendation.findFirst({
      where: {
        id: params.id,
        tenantId: access.tenantId,
      },
    })

    if (!recommendation) return apiError('Recommendation not found', 404)

    const status = ACTION_STATUS_MAP[payload.action]
    const now = new Date()

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.enterpriseAiRecommendation.update({
        where: { id: recommendation.id },
        data: {
          status,
          feedbackNote: payload.note,
          actedByUserId: access.userId,
          actedAt: now,
          snoozedUntil: payload.action === 'snooze' && payload.snoozedUntil ? new Date(payload.snoozedUntil) : null,
        },
      })

      await tx.enterpriseAiRecommendationDecision.create({
        data: {
          recommendationId: recommendation.id,
          tenantId: access.tenantId,
          userId: access.userId,
          action: payload.action,
          note: payload.note,
        },
      })

      await tx.enterpriseAiMetric.create({
        data: {
          tenantId: access.tenantId,
          metricKey: 'recommendation_action',
          metricValue: 1,
          dimensions: {
            action: payload.action,
            recommendationType: recommendation.recommendationType,
          },
        },
      })

      return row
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_RECOMMENDATION_DECISION',
      entity: 'EnterpriseAiRecommendation',
      entityId: updated.id,
      newValues: {
        action: payload.action,
        status,
        note: payload.note,
      },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI RECOMMENDATION PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
