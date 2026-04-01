import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '20'))

    const where = {
      entity: 'subscription_reminder',
      action: 'NOTIFY',
    } as const

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          tenant: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ])

    const data = rows.map((row) => {
      const newValues = (row.newValues || {}) as Record<string, unknown>
      return {
        id: row.id,
        tenantId: row.tenantId,
        tenantName: row.tenant?.name || 'Unknown Tenant',
        userId: row.userId,
        subscriptionId: row.entityId,
        mode: String(newValues.mode || ''),
        channel: String(newValues.channel || ''),
        status: String(newValues.status || ''),
        recipients: Array.isArray(newValues.recipients) ? newValues.recipients : [],
        daysLeft: typeof newValues.daysLeft === 'number' ? newValues.daysLeft : null,
        sentApp: Boolean(newValues.sentApp),
        sentEmail: Boolean(newValues.sentEmail),
        sentAt: String(newValues.sentAt || row.createdAt.toISOString()),
        createdAt: row.createdAt,
      }
    })

    return NextResponse.json({ data, total, page, limit })
  } catch (err) {
    console.error('[SUBSCRIPTION REMINDER LOGS GET]', err)
    return apiError('Internal server error', 500)
  }
}
