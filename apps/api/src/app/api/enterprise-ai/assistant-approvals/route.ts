import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'

type ApprovalQueueItem = {
  recommendationId: string
  status: 'OPEN' | 'SNOOZED'
  createdAt: string
  prompt: string
  provider: string | null
  summary: string
  highPriorityHumanActions: string[]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function toApprovalQueueItem(row: {
  id: string
  status: string
  createdAt: Date
  summary: string
  outputPayload: unknown
}): ApprovalQueueItem | null {
  if (row.status !== 'OPEN' && row.status !== 'SNOOZED') return null

  if (!row.outputPayload || typeof row.outputPayload !== 'object' || Array.isArray(row.outputPayload)) return null

  const payload = row.outputPayload as {
    prompt?: unknown
    provider?: unknown
    brief?: unknown
  }

  if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) return null

  const brief = (payload.brief && typeof payload.brief === 'object' && !Array.isArray(payload.brief))
    ? payload.brief as {
        executionPlan?: unknown
        actions?: unknown
      }
    : null

  const executionPlan = (brief?.executionPlan && typeof brief.executionPlan === 'object' && !Array.isArray(brief.executionPlan))
    ? brief.executionPlan as {
        highPriorityHumanActions?: unknown
      }
    : null

  let highPriorityHumanActions = toStringArray(executionPlan?.highPriorityHumanActions)

  if (highPriorityHumanActions.length === 0) {
    const actions = toStringArray(brief?.actions)
    highPriorityHumanActions = actions
      .filter((action) => action.toUpperCase().includes('HIGH RECOMMENDATION (HUMAN APPROVAL)'))
      .map((action) => action.replace(/^P1\s*-\s*HIGH RECOMMENDATION \(HUMAN APPROVAL\):\s*/i, '').trim())
      .filter(Boolean)
  }

  if (highPriorityHumanActions.length === 0) return null

  return {
    recommendationId: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    prompt: payload.prompt.trim(),
    provider: typeof payload.provider === 'string' ? payload.provider : null,
    summary: row.summary,
    highPriorityHumanActions: highPriorityHumanActions.slice(0, 5),
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
    const includeSnoozed = searchParams.get('includeSnoozed') === 'true'

    const statuses: Array<'OPEN' | 'SNOOZED'> = includeSnoozed ? ['OPEN', 'SNOOZED'] : ['OPEN']

    const rows = await prisma.enterpriseAiRecommendation.findMany({
      where: {
        tenantId: access.tenantId,
        recommendationType: 'NL_ASSISTANT',
        status: { in: statuses },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        status: true,
        createdAt: true,
        summary: true,
        outputPayload: true,
      },
    })

    const data = rows
      .map((row) => toApprovalQueueItem(row))
      .filter((row): row is ApprovalQueueItem => row !== null)
      .slice(0, limit)

    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ASSISTANT APPROVAL QUEUE GET]', err)
    return apiError('Internal server error', 500)
  }
}
