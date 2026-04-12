import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { isAlertPolicyAllowedForRole } from '@/lib/enterprise-ai-route-policy'
import {
  getDefaultEnterpriseAiAlertPolicy,
  parseEnterpriseAiAlertPolicy,
  resolveAlertPolicyFromSignals,
} from '@/lib/enterprise-ai-jobs-logic'

const patchSchema = z.object({
  restoreSignalId: z.string().min(1).optional(),
  minPriorityToNotify: z.enum(['P1', 'P2', 'P3']).optional(),
  quietHoursStartUtc: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEndUtc: z.number().int().min(0).max(23).nullable().optional(),
  suppressAfterAckHours: z.number().int().min(1).max(24 * 14).optional(),
  dedupeHoursByPriority: z.object({
    P1: z.number().int().min(1).max(48).optional(),
    P2: z.number().int().min(1).max(72).optional(),
    P3: z.number().int().min(1).max(24 * 7).optional(),
  }).optional(),
})

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function getEffectivePolicyForTenant(tenantId: string, revisionLimit = 8) {
  const defaults = getDefaultEnterpriseAiAlertPolicy()
  const latestPolicySignal = await prisma.enterpriseAiSignal.findFirst({
    where: {
      signalClass: 'TENANT',
      tenantId,
      signalKey: 'alert_policy',
    },
    orderBy: { effectiveDate: 'desc' },
    select: {
      id: true,
      signalValue: true,
      effectiveDate: true,
      createdAt: true,
      createdByUserId: true,
    },
  })

  const revisionsRows = await prisma.enterpriseAiSignal.findMany({
    where: {
      signalClass: 'TENANT',
      tenantId,
      signalKey: 'alert_policy',
    },
    orderBy: { effectiveDate: 'desc' },
    take: Math.max(1, Math.min(20, revisionLimit)),
    select: {
      id: true,
      signalValue: true,
      effectiveDate: true,
      createdByUserId: true,
      source: true,
      tags: true,
    },
  })

  const revisions = revisionsRows.map((row) => ({
    id: row.id,
    effectiveDate: row.effectiveDate.toISOString(),
    createdByUserId: row.createdByUserId,
    source: row.source,
    tags: row.tags,
    policy: resolveAlertPolicyFromSignals([
      {
        signalClass: 'TENANT',
        signalKey: 'alert_policy',
        signalValue: row.signalValue,
      },
    ], defaults),
  }))

  if (!latestPolicySignal) {
    return {
      policy: defaults,
      source: 'defaults' as const,
      signalId: null,
      updatedAt: null,
      updatedByUserId: null,
      revisions,
    }
  }

  const effectivePolicy = resolveAlertPolicyFromSignals([
    {
      signalClass: 'TENANT',
      signalKey: 'alert_policy',
      signalValue: latestPolicySignal.signalValue,
    },
  ], defaults)

  return {
    policy: effectivePolicy,
    source: 'tenant-signal' as const,
    signalId: latestPolicySignal.id,
    updatedAt: latestPolicySignal.effectiveDate.toISOString(),
    updatedByUserId: latestPolicySignal.createdByUserId,
    revisions,
  }
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isAlertPolicyAllowedForRole(user.role)) {
      return apiError('Forbidden: alert policy is restricted to admin roles', 403)
    }

    const access = await requireEnterpriseAiAccess(user)
    const { searchParams } = new URL(req.url)
    const revisionLimit = Number(searchParams.get('revisionLimit') || 8)
    const result = await getEffectivePolicyForTenant(access.tenantId, revisionLimit)

    return NextResponse.json({
      data: {
        tenantId: access.tenantId,
        ...result,
      },
    })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ALERT POLICY GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isAlertPolicyAllowedForRole(user.role)) {
      return apiError('Forbidden: alert policy is restricted to admin roles', 403)
    }

    const access = await requireEnterpriseAiAccess(user)
    const body = await req.json()
    const payload = patchSchema.parse(body)

    if (payload.restoreSignalId) {
      const sourceSignal = await prisma.enterpriseAiSignal.findFirst({
        where: {
          id: payload.restoreSignalId,
          signalClass: 'TENANT',
          tenantId: access.tenantId,
          signalKey: 'alert_policy',
        },
        select: {
          id: true,
          signalValue: true,
        },
      })

      if (!sourceSignal) {
        return apiError('Policy revision not found for rollback', 404)
      }

      await prisma.enterpriseAiSignal.create({
        data: {
          signalClass: 'TENANT',
          source: 'enterprise-alert-policy-rollback',
          signalKey: 'alert_policy',
          signalValue: toJsonValue(sourceSignal.signalValue),
          tags: ['alert-policy', 'tenant-config', 'rollback', `restored-from:${sourceSignal.id}`],
          effectiveDate: new Date(),
          tenantId: access.tenantId,
          createdByUserId: access.userId,
        },
      })

      const result = await getEffectivePolicyForTenant(access.tenantId)
      return NextResponse.json({
        data: {
          tenantId: access.tenantId,
          ...result,
        },
      })
    }

    const parsed = parseEnterpriseAiAlertPolicy(payload)
    const safePayload = {
      minPriorityToNotify: parsed.minPriorityToNotify ?? payload.minPriorityToNotify,
      quietHoursStartUtc: payload.quietHoursStartUtc === undefined ? undefined : payload.quietHoursStartUtc,
      quietHoursEndUtc: payload.quietHoursEndUtc === undefined ? undefined : payload.quietHoursEndUtc,
      suppressAfterAckHours: parsed.suppressAfterAckHours,
      dedupeHoursByPriority: {
        ...(parsed.dedupeHoursByPriority?.P1 ? { P1: parsed.dedupeHoursByPriority.P1 } : {}),
        ...(parsed.dedupeHoursByPriority?.P2 ? { P2: parsed.dedupeHoursByPriority.P2 } : {}),
        ...(parsed.dedupeHoursByPriority?.P3 ? { P3: parsed.dedupeHoursByPriority.P3 } : {}),
      },
    }

    await prisma.enterpriseAiSignal.create({
      data: {
        signalClass: 'TENANT',
        source: 'enterprise-alert-policy-console',
        signalKey: 'alert_policy',
        signalValue: safePayload,
        tags: ['alert-policy', 'tenant-config'],
        effectiveDate: new Date(),
        tenantId: access.tenantId,
        createdByUserId: access.userId,
      },
    })

    const result = await getEffectivePolicyForTenant(access.tenantId)

    return NextResponse.json({
      data: {
        tenantId: access.tenantId,
        ...result,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI ALERT POLICY PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
