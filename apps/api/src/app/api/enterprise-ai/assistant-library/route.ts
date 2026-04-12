import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { logAudit } from '@/lib/audit'

const saveSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  response: z.string().trim().min(1).max(20000),
  currencyCode: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  incomeBreakdown: z.object({
    totalIncome: z.number(),
    salesIncome: z.number(),
    subscriptionIncome: z.number(),
    streamMix: z.object({
      salesPct: z.number(),
      subscriptionPct: z.number(),
    }),
  }).optional(),
  conversationId: z.string().max(120).optional(),
  provider: z.string().max(120).optional(),
  sourceRecommendationId: z.string().max(120).optional(),
  brief: z.object({
    summary: z.string(),
    comparativeInsights: z.array(z.string()),
    actions: z.array(z.string()),
    risks: z.array(z.string()),
    followUpQuestions: z.array(z.string()),
    alerts: z.array(z.object({
      severity: z.enum(['critical', 'warning', 'info']),
      message: z.string(),
      actionRequired: z.string(),
    })).optional(),
  }).optional(),
})

type SavedAssistantItem = {
  id: string
  prompt: string
  response: string
  createdAt: string
  currencyCode?: string
  incomeBreakdown?: {
    totalIncome: number
    salesIncome: number
    subscriptionIncome: number
    streamMix: {
      salesPct: number
      subscriptionPct: number
    }
  }
  conversationId?: string
  provider?: string
  sourceRecommendationId?: string
  brief?: {
    summary: string
    comparativeInsights: string[]
    actions: string[]
    risks: string[]
    followUpQuestions: string[]
    alerts?: Array<{
      severity: 'critical' | 'warning' | 'info'
      message: string
      actionRequired: string
    }>
  }
}

function toSavedAssistantItem(row: { id: string; createdAt: Date; outputPayload: unknown }): SavedAssistantItem | null {
  if (!row.outputPayload || typeof row.outputPayload !== 'object' || Array.isArray(row.outputPayload)) return null

  const payload = row.outputPayload as {
    prompt?: unknown
    response?: unknown
    currencyCode?: unknown
    incomeBreakdown?: unknown
    conversationId?: unknown
    provider?: unknown
    savedForLater?: unknown
    sourceRecommendationId?: unknown
    brief?: unknown
  }

  if (payload.savedForLater !== true) return null
  if (typeof payload.prompt !== 'string' || typeof payload.response !== 'string') return null

  let brief: SavedAssistantItem['brief'] | undefined
  let incomeBreakdown: SavedAssistantItem['incomeBreakdown'] | undefined
  if (payload.brief && typeof payload.brief === 'object' && !Array.isArray(payload.brief)) {
    const maybeBrief = payload.brief as {
      summary?: unknown
      comparativeInsights?: unknown
      actions?: unknown
      risks?: unknown
      followUpQuestions?: unknown
      alerts?: unknown
    }

    const toStringArray = (value: unknown) => Array.isArray(value)
      ? value.filter((x): x is string => typeof x === 'string')
      : []

    if (typeof maybeBrief.summary === 'string') {
      const alerts = Array.isArray(maybeBrief.alerts)
        ? maybeBrief.alerts
          .map((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
            const value = entry as { severity?: unknown; message?: unknown; actionRequired?: unknown }
            if (
              (value.severity !== 'critical' && value.severity !== 'warning' && value.severity !== 'info') ||
              typeof value.message !== 'string' ||
              typeof value.actionRequired !== 'string'
            ) {
              return null
            }
            return {
              severity: value.severity,
              message: value.message,
              actionRequired: value.actionRequired,
            }
          })
          .filter((entry): entry is { severity: 'critical' | 'warning' | 'info'; message: string; actionRequired: string } => Boolean(entry))
        : []

      brief = {
        summary: maybeBrief.summary,
        comparativeInsights: toStringArray(maybeBrief.comparativeInsights),
        actions: toStringArray(maybeBrief.actions),
        risks: toStringArray(maybeBrief.risks),
        followUpQuestions: toStringArray(maybeBrief.followUpQuestions),
        alerts,
      }
    }
  }

  if (payload.incomeBreakdown && typeof payload.incomeBreakdown === 'object' && !Array.isArray(payload.incomeBreakdown)) {
    const maybeIncome = payload.incomeBreakdown as {
      totalIncome?: unknown
      salesIncome?: unknown
      subscriptionIncome?: unknown
      streamMix?: unknown
    }

    const maybeMix = maybeIncome.streamMix as { salesPct?: unknown; subscriptionPct?: unknown } | undefined
    const totalIncome = Number(maybeIncome.totalIncome)
    const salesIncome = Number(maybeIncome.salesIncome)
    const subscriptionIncome = Number(maybeIncome.subscriptionIncome)
    const salesPct = Number(maybeMix?.salesPct)
    const subscriptionPct = Number(maybeMix?.subscriptionPct)

    if (
      Number.isFinite(totalIncome) &&
      Number.isFinite(salesIncome) &&
      Number.isFinite(subscriptionIncome) &&
      Number.isFinite(salesPct) &&
      Number.isFinite(subscriptionPct)
    ) {
      incomeBreakdown = {
        totalIncome,
        salesIncome,
        subscriptionIncome,
        streamMix: {
          salesPct,
          subscriptionPct,
        },
      }
    }
  }

  return {
    id: row.id,
    prompt: payload.prompt,
    response: payload.response,
    createdAt: row.createdAt.toISOString(),
    currencyCode: typeof payload.currencyCode === 'string' ? payload.currencyCode : undefined,
    incomeBreakdown,
    conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : undefined,
    provider: typeof payload.provider === 'string' ? payload.provider : undefined,
    sourceRecommendationId: typeof payload.sourceRecommendationId === 'string' ? payload.sourceRecommendationId : undefined,
    brief,
  }
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['AI_NATURAL_LANGUAGE_ASSISTANT'])
    const { searchParams } = new URL(req.url)
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)))

    const rows = await prisma.enterpriseAiRecommendation.findMany({
      where: {
        tenantId: access.tenantId,
        recommendationType: 'NL_ASSISTANT',
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        outputPayload: true,
      },
    })

    const data = rows
      .map((row) => toSavedAssistantItem(row))
      .filter((item): item is SavedAssistantItem => item !== null)
      .slice(0, limit)

    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ASSISTANT LIBRARY GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const body = await req.json()
    const payload = saveSchema.parse(body)
    const access = await requireEnterpriseAiAccess(user, ['AI_NATURAL_LANGUAGE_ASSISTANT'])

    const created = await prisma.enterpriseAiRecommendation.create({
      data: {
        tenantId: access.tenantId,
        recommendationType: 'NL_ASSISTANT',
        title: 'Saved assistant prompt and response',
        summary: 'Saved by business admin for later review/printing.',
        reasonCodes: ['ASSISTANT_SAVED_FOR_LATER'],
        sourceProvenance: ['tenant:assistant-ui'],
        modelVersion: 'assistant-manual-save-v1',
        inputSnapshot: {
          source: 'manual-save',
          savedAt: new Date().toISOString(),
        },
        outputPayload: {
          prompt: payload.prompt,
          response: payload.response,
          currencyCode: payload.currencyCode || null,
          incomeBreakdown: payload.incomeBreakdown || null,
          conversationId: payload.conversationId || null,
          provider: payload.provider || null,
          sourceRecommendationId: payload.sourceRecommendationId || null,
          brief: payload.brief || null,
          savedForLater: true,
          savedByUserId: access.userId,
          savedAt: new Date().toISOString(),
        },
      },
      select: {
        id: true,
        createdAt: true,
        outputPayload: true,
      },
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_ASSISTANT_SAVE',
      entity: 'EnterpriseAiRecommendation',
      entityId: created.id,
      newValues: {
        sourceRecommendationId: payload.sourceRecommendationId || null,
        conversationId: payload.conversationId || null,
      },
      req,
    })

    const data = toSavedAssistantItem(created)
    if (!data) return apiError('Unable to save assistant response', 500)
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ASSISTANT LIBRARY POST]', err)
    return apiError('Internal server error', 500)
  }
}