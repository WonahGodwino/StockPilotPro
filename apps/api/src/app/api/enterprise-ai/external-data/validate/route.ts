import { NextRequest, NextResponse } from 'next/server'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { logAudit } from '@/lib/audit'
import { validateExternalMappings } from '@/lib/enterprise-ai-external-data'

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['ENTERPRISE_AI_EXTERNAL_DATA'])
    const data = await validateExternalMappings(access.tenantId)

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_EXTERNAL_DATA_VALIDATE',
      entity: 'EnterpriseAiExternalDataConnection',
      newValues: {
        ok: data.ok,
        missingEntities: data.missingEntities,
      },
      req,
    })

    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI EXTERNAL DATA VALIDATE]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}
