import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { logAudit } from '@/lib/audit'

function isSavedAssistantPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as { savedForLater?: unknown; prompt?: unknown; response?: unknown }
  return payload.savedForLater === true && typeof payload.prompt === 'string' && typeof payload.response === 'string'
}

export async function OPTIONS() {
  return handleOptions()
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['AI_NATURAL_LANGUAGE_ASSISTANT'])

    const row = await prisma.enterpriseAiRecommendation.findFirst({
      where: {
        id: params.id,
        tenantId: access.tenantId,
        recommendationType: 'NL_ASSISTANT',
      },
      select: {
        id: true,
        outputPayload: true,
      },
    })

    if (!row || !isSavedAssistantPayload(row.outputPayload)) {
      return apiError('Saved assistant entry not found', 404)
    }

    await prisma.enterpriseAiRecommendation.delete({
      where: { id: row.id },
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_ASSISTANT_DELETE',
      entity: 'EnterpriseAiRecommendation',
      entityId: row.id,
      req,
    })

    return NextResponse.json({ data: { id: row.id, deleted: true } })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ASSISTANT LIBRARY DELETE]', err)
    return apiError('Internal server error', 500)
  }
}
