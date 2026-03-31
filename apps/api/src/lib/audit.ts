import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { getClientIp, getUserAgent } from './auth'

type AuditInput = {
  tenantId: string | null | undefined
  userId?: string | null
  action: string
  entity: string
  entityId?: string | null
  oldValues?: unknown
  newValues?: unknown
  req?: NextRequest
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function logAudit(input: AuditInput) {
  if (!input.tenantId) return

  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId || null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId || null,
        oldValues: toJson(input.oldValues),
        newValues: toJson(input.newValues),
        ipAddress: input.req ? getClientIp(input.req) : null,
        userAgent: input.req ? getUserAgent(input.req) : null,
      },
    })
  } catch (err) {
    // Audit logging must never block core operations.
    console.error('[AUDIT LOGGING]', err)
  }
}
