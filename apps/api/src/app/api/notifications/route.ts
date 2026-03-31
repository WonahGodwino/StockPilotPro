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

    const tenantId = isSuperAdmin(user)
      ? new URL(req.url).searchParams.get('tenantId') || undefined
      : user.tenantId!

    const type = new URL(req.url).searchParams.get('type') || undefined
    const page = parseInt(new URL(req.url).searchParams.get('page') || '1')
    const limit = parseInt(new URL(req.url).searchParams.get('limit') || '20')

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { ...(tenantId ? { tenantId } : {}), ...(type ? { type } : {}) },
        include: {
          product: { select: { name: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: { ...(tenantId ? { tenantId } : {}), ...(type ? { type } : {}) } }),
      prisma.notification.count({ where: { ...(tenantId ? { tenantId } : {}), isRead: false } }),
    ])

    return NextResponse.json({ data: notifications, total, unreadCount, page, limit })
  } catch (err) {
    console.error('[NOTIFICATIONS GET]', err)
    return apiError('Internal server error', 500)
  }
}
