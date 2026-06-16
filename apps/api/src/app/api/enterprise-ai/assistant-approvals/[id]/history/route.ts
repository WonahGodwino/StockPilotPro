import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'

type ApprovalDecisionHistoryItem = {
  id: string
  action: string
  note: string | null
  createdAt: string
  actor: {
    userId: string
    firstName: string
    lastName: string
    email: string
    role: string
  } | null
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['AI_NATURAL_LANGUAGE_ASSISTANT'])

    const recommendation = await prisma.enterpriseAiRecommendation.findFirst({
      where: {
        id: params.id,
        tenantId: access.tenantId,
        recommendationType: 'NL_ASSISTANT',
      },
      select: {
        id: true,
        status: true,
        title: true,
        summary: true,
        actedAt: true,
        actedByUserId: true,
      },
    })

    if (!recommendation) {
      return apiError('Approval queue item not found', 404)
    }

    const rows = await prisma.enterpriseAiRecommendationDecision.findMany({
      where: {
        recommendationId: recommendation.id,
        tenantId: access.tenantId,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        note: true,
        createdAt: true,
        userId: true,
      },
    })

    const userIds = Array.from(new Set(rows.map((row) => row.userId).filter(Boolean)))
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        })
      : []

    const userMap = new Map(users.map((item) => [item.id, item]))

    const history: ApprovalDecisionHistoryItem[] = rows.map((row) => {
      const actor = userMap.get(row.userId)
      return {
        id: row.id,
        action: row.action,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        actor: actor
          ? {
              userId: actor.id,
              firstName: actor.firstName,
              lastName: actor.lastName,
              email: actor.email,
              role: actor.role,
            }
          : null,
      }
    })

    return NextResponse.json({
      data: {
        recommendationId: recommendation.id,
        status: recommendation.status,
        title: recommendation.title,
        summary: recommendation.summary,
        actedAt: recommendation.actedAt?.toISOString() || null,
        actedByUserId: recommendation.actedByUserId || null,
        history,
      },
    })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ASSISTANT APPROVAL HISTORY GET]', err)
    return apiError('Internal server error', 500)
  }
}
