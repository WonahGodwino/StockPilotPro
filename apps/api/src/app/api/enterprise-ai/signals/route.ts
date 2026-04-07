import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { resolveSignalTenantScope } from '@/lib/enterprise-ai-route-policy'

const postSchema = z.object({
  signalClass: z.enum(['PUBLIC', 'PLATFORM', 'TENANT']),
  source: z.string().trim().min(2).max(80),
  signalKey: z.string().trim().min(2).max(120),
  signalValue: z.record(z.any()),
  tags: z.array(z.string().trim().min(1).max(50)).optional(),
  effectiveDate: z.string().datetime().optional(),
  tenantId: z.string().trim().optional(),
})

const SENSITIVE_KEY_PATTERNS = [
  /email/i,
  /phone/i,
  /tenant.?id/i,
  /user.?id/i,
  /password/i,
  /token/i,
]

function collectSensitiveKeys(value: unknown, path = 'root', hits: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => collectSensitiveKeys(item, `${path}[${idx}]`, hits))
    return hits
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        hits.push(`${path}.${key}`)
      }
      collectSensitiveKeys(nested, `${path}.${key}`, hits)
    }
  }

  return hits
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const { searchParams } = new URL(req.url)
    const signalClass = searchParams.get('signalClass')

    const signals = await prisma.enterpriseAiSignal.findMany({
      where: {
        OR: [
          { signalClass: 'PUBLIC' },
          { signalClass: 'PLATFORM' },
          { signalClass: 'TENANT', tenantId: access.tenantId },
        ],
        ...(signalClass && ['PUBLIC', 'PLATFORM', 'TENANT'].includes(signalClass)
          ? { signalClass: signalClass as 'PUBLIC' | 'PLATFORM' | 'TENANT' }
          : {}),
      },
      orderBy: { effectiveDate: 'desc' },
      take: 100,
    })

    return NextResponse.json({ data: signals })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI SIGNALS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = postSchema.parse(body)

    if (payload.signalClass !== 'TENANT') {
      const sensitiveHits = collectSensitiveKeys(payload.signalValue)
      if (sensitiveHits.length > 0) {
        return apiError(`Signal value contains sensitive or tenant-identifying keys: ${sensitiveHits.slice(0, 5).join(', ')}`, 422)
      }
    }

    let tenantId: string | null
    try {
      tenantId = resolveSignalTenantScope({
        role: user.role,
        signalClass: payload.signalClass,
        payloadTenantId: payload.tenantId,
        accessTenantId: access.tenantId,
      })
    } catch (policyErr) {
      const msg = (policyErr as Error).message || 'Forbidden'
      return apiError(msg, 403)
    }

    const signal = await prisma.enterpriseAiSignal.create({
      data: {
        signalClass: payload.signalClass,
        source: payload.source,
        signalKey: payload.signalKey,
        signalValue: payload.signalValue,
        tags: payload.tags || [],
        effectiveDate: payload.effectiveDate ? new Date(payload.effectiveDate) : new Date(),
        tenantId,
        createdByUserId: user.userId,
      },
    })

    return NextResponse.json({ data: signal }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI SIGNALS POST]', err)
    return apiError('Internal server error', 500)
  }
}
