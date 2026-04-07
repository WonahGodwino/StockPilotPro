import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, requirePermission } from '@/lib/rbac'

type StaleUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  lastSeenAt: Date | null
  thresholdHours: number
  hoursSinceLastSeen: number
}

function parseThresholdHours(value?: string | null): number[] {
  const raw = (value || '24,72').split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0)
  const unique = Array.from(new Set(raw)).sort((a, b) => a - b)
  return unique.length > 0 ? unique : [24, 72]
}

function getStaleThreshold(hoursSinceLastSeen: number, thresholds: number[]): number | null {
  let exceeded: number | null = null
  for (const threshold of thresholds) {
    if (hoursSinceLastSeen >= threshold) exceeded = threshold
  }
  return exceeded
}

function buildStaleUsers(users: Array<{ id: string; email: string; firstName: string; lastName: string; lastSeenAt: Date | null }>, thresholds: number[]): StaleUser[] {
  const now = Date.now()
  const stale: StaleUser[] = []

  for (const user of users) {
    const lastSeenMs = user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0
    const hoursSinceLastSeen = lastSeenMs > 0 ? Math.floor((now - lastSeenMs) / (1000 * 60 * 60)) : 24 * 365
    const thresholdHours = getStaleThreshold(hoursSinceLastSeen, thresholds)
    if (!thresholdHours) continue

    stale.push({
      ...user,
      thresholdHours,
      hoursSinceLastSeen,
    })
  }

  return stale.sort((a, b) => b.hoursSinceLastSeen - a.hoursSinceLastSeen)
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'manage:users')
    if (isSuperAdmin(user)) return apiError('SUPER_ADMIN does not manage tenant salesperson activity', 403)

    const { searchParams } = new URL(req.url)
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const thresholds = parseThresholdHours(searchParams.get('hours'))

    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account. Provide tenantId.', 400)
    }

    const users = await prisma.user.findMany({
      where: {
        tenantId,
        archived: false,
        role: 'SALESPERSON',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const staleUsers = buildStaleUsers(users, thresholds)

    return NextResponse.json({
      data: {
        thresholds,
        staleCount: staleUsers.length,
        staleUsers,
      },
    })
  } catch (err) {
    if ((err as Error).message === 'No token provided' || (err as Error).message === 'Unauthorized') {
      return apiError('Unauthorized', 401)
    }
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[STALE USERS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'manage:users')
    if (isSuperAdmin(user)) return apiError('SUPER_ADMIN does not manage tenant salesperson activity', 403)

    const { searchParams } = new URL(req.url)
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const thresholds = parseThresholdHours(searchParams.get('hours'))

    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account. Provide tenantId.', 400)
    }

    const users = await prisma.user.findMany({
      where: {
        tenantId,
        archived: false,
        role: 'SALESPERSON',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        lastSeenAt: true,
      },
    })

    const staleUsers = buildStaleUsers(users, thresholds)
    if (staleUsers.length === 0) {
      return NextResponse.json({ data: { sent: 0, skipped: 0 } })
    }

    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    let sent = 0
    let skipped = 0

    for (const staleUser of staleUsers) {
      const dedupeKey = `STALE_USER:${staleUser.id}:${staleUser.thresholdHours}:${dayStart.toISOString().slice(0, 10)}`

      const existing = await prisma.notification.findFirst({
        where: {
          tenantId,
          type: 'SYSTEM',
          createdAt: { gte: dayStart },
          message: { contains: dedupeKey },
        },
        select: { id: true },
      })

      if (existing) {
        skipped += 1
        continue
      }

      await prisma.notification.create({
        data: {
          tenantId,
          type: 'SYSTEM',
          title: `Inactive salesperson (${staleUser.thresholdHours}h+)`,
          message: `${staleUser.firstName} ${staleUser.lastName} has not been seen for ${staleUser.hoursSinceLastSeen} hours. ${dedupeKey}`,
        },
      })

      sent += 1
    }

    return NextResponse.json({ data: { sent, skipped } })
  } catch (err) {
    if ((err as Error).message === 'No token provided' || (err as Error).message === 'Unauthorized') {
      return apiError('Unauthorized', 401)
    }
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    if ((err as Error).message === 'Unauthorized') return apiError('Unauthorized', 401)
    console.error('[STALE USERS POST]', err)
    return apiError('Internal server error', 500)
  }
}
