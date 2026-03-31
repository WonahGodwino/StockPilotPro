import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)

    const notification = await prisma.notification.findUnique({ where: { id: params.id } })
    if (!notification) return apiError('Not found', 404)
    if (!isSuperAdmin(user) && notification.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    const updated = await prisma.notification.update({
      where: { id: params.id },
      data: { isRead: true },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[NOTIFICATION READ]', err)
    return apiError('Internal server error', 500)
  }
}
