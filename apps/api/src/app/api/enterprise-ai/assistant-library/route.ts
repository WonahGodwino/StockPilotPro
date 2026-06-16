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
  groundingSource: z.enum(['internal', 'external']).optional(),
  externalData: z.object({
    externalGroundingReady: z.boolean(),
    contractIssues: z.array(z.object({
      entity: z.string(),
      missingMappings: z.array(z.string()),
      missingSchemaColumns: z.array(z.string()),
    })).optional(),
  }).nullable().optional(),
  sourceRecommendationId: z.string().max(120).optional(),
  brief: z.object({
    summary: z.string(),
    comparativeInsights: z.array(z.string()),
    actions: z.array(z.string()),
    risks: z.array(z.string()),
    followUpQuestions: z.array(z.string()),
    responseMode: z.enum(['clarify', 'brief', 'deep']).optional(),
    clarificationPrompt: z.string().optional(),
    businessGuidance: z.object({
      operatingMode: z.enum(['clarification_needed', 'insufficient_evidence', 'monitor_only', 'manual_intervention', 'decision_ready']),
      confidenceLabel: z.string(),
      why: z.string(),
      primaryRecommendation: z.string(),
      expectedImpact: z.string(),
      nextReview: z.string(),
      audience: z.string(),
    }).optional(),
    groundingNotes: z.array(z.string()).optional(),
    factBasis: z.array(z.string()).optional(),
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
  groundingSource?: 'internal' | 'external'
  externalData?: {
    externalGroundingReady: boolean
    contractIssues: Array<{
      entity: string
      missingMappings: string[]
      missingSchemaColumns: string[]
    }>
  } | null
  sourceRecommendationId?: string
  brief?: {
    summary: string
    comparativeInsights: string[]
    actions: string[]
    risks: string[]
    followUpQuestions: string[]
    responseMode?: 'clarify' | 'brief' | 'deep'
    clarificationPrompt?: string
    businessGuidance?: {
      operatingMode: 'clarification_needed' | 'insufficient_evidence' | 'monitor_only' | 'manual_intervention' | 'decision_ready'
      confidenceLabel: string
      why: string
      primaryRecommendation: string
      expectedImpact: string
      nextReview: string
      audience: string
    }
    groundingNotes?: string[]
    factBasis?: string[]
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
    groundingSource?: unknown
    externalData?: unknown
    savedForLater?: unknown
    sourceRecommendationId?: unknown
    brief?: unknown
  }

  if (payload.savedForLater !== true) return null
  if (typeof payload.prompt !== 'string' || typeof payload.response !== 'string') return null

  let brief: SavedAssistantItem['brief'] | undefined
  let incomeBreakdown: SavedAssistantItem['incomeBreakdown'] | undefined
  let externalData: SavedAssistantItem['externalData'] | undefined
  if (payload.brief && typeof payload.brief === 'object' && !Array.isArray(payload.brief)) {
    const maybeBrief = payload.brief as {
      summary?: unknown
      comparativeInsights?: unknown
      actions?: unknown
      risks?: unknown
      followUpQuestions?: unknown
      responseMode?: unknown
      clarificationPrompt?: unknown
      businessGuidance?: unknown
      groundingNotes?: unknown
      factBasis?: unknown
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
        responseMode: maybeBrief.responseMode === 'clarify' || maybeBrief.responseMode === 'brief' || maybeBrief.responseMode === 'deep'
          ? maybeBrief.responseMode
          : undefined,
        clarificationPrompt: typeof maybeBrief.clarificationPrompt === 'string' ? maybeBrief.clarificationPrompt : undefined,
        businessGuidance: maybeBrief.businessGuidance && typeof maybeBrief.businessGuidance === 'object' && !Array.isArray(maybeBrief.businessGuidance)
          ? (() => {
              const value = maybeBrief.businessGuidance as {
                operatingMode?: unknown
                confidenceLabel?: unknown
                why?: unknown
                primaryRecommendation?: unknown
                expectedImpact?: unknown
                nextReview?: unknown
                audience?: unknown
              }
              if (
                (value.operatingMode !== 'clarification_needed'
                  && value.operatingMode !== 'insufficient_evidence'
                  && value.operatingMode !== 'monitor_only'
                  && value.operatingMode !== 'manual_intervention'
                  && value.operatingMode !== 'decision_ready')
                || typeof value.confidenceLabel !== 'string'
                || typeof value.why !== 'string'
                || typeof value.primaryRecommendation !== 'string'
                || typeof value.expectedImpact !== 'string'
                || typeof value.nextReview !== 'string'
                || typeof value.audience !== 'string'
              ) {
                return undefined
              }
              return {
                operatingMode: value.operatingMode,
                confidenceLabel: value.confidenceLabel,
                why: value.why,
                primaryRecommendation: value.primaryRecommendation,
                expectedImpact: value.expectedImpact,
                nextReview: value.nextReview,
                audience: value.audience,
              }
            })()
          : undefined,
        groundingNotes: toStringArray(maybeBrief.groundingNotes),
        factBasis: toStringArray(maybeBrief.factBasis),
        alerts,
      }
    }
  }

  if (payload.externalData === null) {
    externalData = null
  } else if (payload.externalData && typeof payload.externalData === 'object' && !Array.isArray(payload.externalData)) {
    const maybeExternalData = payload.externalData as {
      externalGroundingReady?: unknown
      contractIssues?: unknown
    }

    if (typeof maybeExternalData.externalGroundingReady === 'boolean') {
      externalData = {
        externalGroundingReady: maybeExternalData.externalGroundingReady,
        contractIssues: Array.isArray(maybeExternalData.contractIssues)
          ? maybeExternalData.contractIssues
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
              const value = entry as {
                entity?: unknown
                missingMappings?: unknown
                missingSchemaColumns?: unknown
              }
              if (typeof value.entity !== 'string') return null
              return {
                entity: value.entity,
                missingMappings: Array.isArray(value.missingMappings)
                  ? value.missingMappings.filter((item): item is string => typeof item === 'string')
                  : [],
                missingSchemaColumns: Array.isArray(value.missingSchemaColumns)
                  ? value.missingSchemaColumns.filter((item): item is string => typeof item === 'string')
                  : [],
              }
            })
            .filter((entry): entry is { entity: string; missingMappings: string[]; missingSchemaColumns: string[] } => Boolean(entry))
          : [],
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
    groundingSource: payload.groundingSource === 'internal' || payload.groundingSource === 'external'
      ? payload.groundingSource
      : undefined,
    externalData,
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
          groundingSource: payload.groundingSource || null,
          externalData: payload.externalData || null,
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