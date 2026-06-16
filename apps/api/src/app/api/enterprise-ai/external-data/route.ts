import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import {
  disableExternalDataConnection,
  getExternalDataConnectionSummary,
  saveExternalMappings,
  upsertExternalDataConnection,
} from '@/lib/enterprise-ai-external-data'

const connectSchema = z.object({
  providerType: z.literal('postgresql'),
  connectionName: z.string().min(1).max(120).optional(),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  databaseName: z.string().min(1).max(255),
  schemaName: z.string().min(1).max(120).optional().default('public'),
  sslRequired: z.boolean().optional().default(true),
  username: z.string().min(1).max(255).optional(),
  password: z.string().min(1).max(1024).optional(),
})

const mappingEntitySchema = z.object({
  table: z.string().min(1),
  columns: z.record(z.string().min(1)),
})

const patchSchema = z.object({
  mappingConfig: z.object({
    sales: mappingEntitySchema.optional(),
    saleItems: mappingEntitySchema.optional(),
    expenses: mappingEntitySchema.optional(),
    products: mappingEntitySchema.optional(),
    inventory: mappingEntitySchema.optional(),
    branches: mappingEntitySchema.optional(),
  }),
  groundingEnabled: z.boolean().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['ENTERPRISE_AI_EXTERNAL_DATA'])
    const data = await getExternalDataConnectionSummary(access.tenantId)
    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI EXTERNAL DATA GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['ENTERPRISE_AI_EXTERNAL_DATA'])
    const body = await req.json()
    const payload = connectSchema.parse(body)

    const data = await upsertExternalDataConnection({
      tenantId: access.tenantId,
      userId: access.userId,
      ...payload,
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_EXTERNAL_DATA_CONNECT',
      entity: 'EnterpriseAiExternalDataConnection',
      entityId: data.id,
      newValues: {
        providerType: data.providerType,
        host: data.host,
        databaseName: data.databaseName,
        schemaName: data.schemaName,
        status: data.status,
      },
      req,
    })

    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI EXTERNAL DATA POST]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['ENTERPRISE_AI_EXTERNAL_DATA'])
    const body = await req.json()
    const payload = patchSchema.parse(body)

    const data = await saveExternalMappings({
      tenantId: access.tenantId,
      userId: access.userId,
      mappingConfig: payload.mappingConfig,
      groundingEnabled: payload.groundingEnabled,
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_EXTERNAL_DATA_MAPPING_SAVE',
      entity: 'EnterpriseAiExternalDataConnection',
      entityId: data.id,
      newValues: {
        validationState: data.validationState,
        groundingEnabled: data.groundingEnabled,
      },
      req,
    })

    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI EXTERNAL DATA PATCH]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user, ['ENTERPRISE_AI_EXTERNAL_DATA'])
    const data = await disableExternalDataConnection({ tenantId: access.tenantId, userId: access.userId })
    if (!data) return apiError('External data connection not found', 404)

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_EXTERNAL_DATA_DISABLE',
      entity: 'EnterpriseAiExternalDataConnection',
      entityId: data.id,
      newValues: { status: data.status, isActive: data.isActive },
      req,
    })

    return NextResponse.json({ data })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI EXTERNAL DATA DELETE]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}
