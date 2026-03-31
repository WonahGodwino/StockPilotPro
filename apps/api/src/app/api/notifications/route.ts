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

    const { searchParams } = new URL(req.url)

    const tenantId = isSuperAdmin(user)
      ? searchParams.get('tenantId') || undefined
      : user.tenantId!
    const type = searchParams.get('type') || undefined
    const unreadOnly = searchParams.get('unread') === 'true'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const baseWhere = {
      ...(tenantId ? { tenantId } : {}),
      ...(type ? { type } : {}),
      ...(unreadOnly ? { isRead: false } : {}),
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: baseWhere,
        include: {
          product: { select: { name: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: baseWhere }),
      prisma.notification.count({ where: { ...(tenantId ? { tenantId } : {}), isRead: false } }),
    ])

    return NextResponse.json({ data: notifications, total, unreadCount, page, limit })
  } catch (err) {
    console.error('[NOTIFICATIONS GET]', err)
    return apiError('Internal server error', 500)
  }
}
