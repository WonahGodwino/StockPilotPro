import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { hasPermission, isSuperAdmin } from '@/lib/rbac'

const postSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(32).optional(),
  status: z.enum(['success', 'partial', 'failed', 'noop']),
  pendingBefore: z.number().int().min(0).default(0),
  syncedCount: z.number().int().min(0).default(0),
  failedCount: z.number().int().min(0).default(0),
  error: z.string().max(500).optional(),
  subsidiaryId: z.string().trim().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!user.tenantId) return apiError('No tenant context for this account.', 400)

    const body = await req.json()
    const payload = postSchema.parse(body)

    const subsidiaryId = user.subsidiaryId || payload.subsidiaryId || null

    const telemetry = await prisma.syncTelemetry.create({
      data: {
        tenantId: user.tenantId,
        subsidiaryId,
        userId: user.userId,
        deviceId: payload.deviceId,
        source: payload.source || 'web',
        status: payload.status,
        pendingBefore: payload.pendingBefore,
        syncedCount: payload.syncedCount,
        failedCount: payload.failedCount,
        error: payload.error,
      },
      select: { id: true, createdAt: true },
    })

    return NextResponse.json({ data: telemetry }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[SYNC TELEMETRY POST]', err)
    return apiError('Internal server error', 500)
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:reports')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) return apiError('No tenant context for this account. Provide tenantId.', 400)

    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 100)))
    const deviceId = searchParams.get('deviceId') || undefined
    const status = searchParams.get('status') || undefined
    const subsidiaryId = searchParams.get('subsidiaryId') || undefined

    const createdAt = from || to
      ? {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        }
      : undefined

    const where = {
      tenantId,
      ...(deviceId ? { deviceId } : {}),
      ...(status ? { status } : {}),
      ...(subsidiaryId ? { subsidiaryId } : {}),
      ...(createdAt ? { createdAt } : {}),
    }

    const rows = await prisma.syncTelemetry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        deviceId: true,
        source: true,
        status: true,
        pendingBefore: true,
        syncedCount: true,
        failedCount: true,
        error: true,
        createdAt: true,
        subsidiary: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    })

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalRuns += 1
        acc.syncedCount += row.syncedCount
        acc.failedCount += row.failedCount
        if (row.status === 'success') acc.successRuns += 1
        if (row.status === 'partial') acc.partialRuns += 1
        if (row.status === 'failed') acc.failedRuns += 1
        if (row.status === 'noop') acc.noopRuns += 1
        return acc
      },
      {
        totalRuns: 0,
        successRuns: 0,
        partialRuns: 0,
        failedRuns: 0,
        noopRuns: 0,
        syncedCount: 0,
        failedCount: 0,
      }
    )

    return NextResponse.json({ data: { summary, rows } })
  } catch (err) {
    console.error('[SYNC TELEMETRY GET]', err)
    return apiError('Internal server error', 500)
  }
}
