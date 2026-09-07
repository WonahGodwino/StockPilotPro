import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

/**
 * GET /api/storefront/orders
 * Admin/Sales — list all online orders for their tenant
 */
export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'view:sales')

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '20'))

    const where = {
      tenantId: user.tenantId!,
      source: 'ONLINE' as const,
      archived: false,
      ...(status ? { trackingStatus: status as any } : {}),
      ...(search ? {
        OR: [
          { trackingCode: { contains: search, mode: 'insensitive' as const } },
          { receiptNumber: { contains: search, mode: 'insensitive' as const } },
          { customer: { name: { contains: search, mode: 'insensitive' as const } } },
          { customer: { email: { contains: search, mode: 'insensitive' as const } } },
        ],
      } : {}),
    }

    const [orders, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          items: { include: { product: { select: { name: true, unit: true, imageUrl: true } } } },
          customer: { select: { id: true, name: true, email: true, phone: true } },
          subsidiary: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ])

    return NextResponse.json({ data: orders, total, page, limit })
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return apiError('Forbidden', 403)
    console.error('[ADMIN ORDERS]', err)
    return apiError('Internal server error', 500)
  }
}

const updateSchema = z.object({
  trackingStatus: z.enum(['PAYMENT_VALIDATED', 'GOODS_PACKED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
  validationNote: z.string().optional(),
})

/**
 * PUT /api/storefront/orders
 * Admin/Sales — update order tracking status
 * Body: { id: string, trackingStatus: string, validationNote?: string }
 */
export async function PUT(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'view:sales')

    const body = await req.json()
    const { id, ...rest } = body
    const data = updateSchema.parse(rest)

    const sale = await prisma.sale.findFirst({
      where: { id, tenantId: user.tenantId!, source: 'ONLINE' },
      select: { id: true, trackingStatus: true },
    })

    if (!sale) {
      return apiError('Order not found', 404)
    }

    const updateData: any = {
      trackingStatus: data.trackingStatus,
      trackingHistory: [
        ...((sale as any).trackingHistory || (sale as any).trackingHistory === null ? [] : []),
        {
          status: data.trackingStatus,
          changedBy: user.email,
          changedByUserId: user.userId,
          changedAt: new Date().toISOString(),
          note: data.validationNote || '',
        },
      ],
    }

    // When validating payment, also set the validation fields
    if (data.trackingStatus === 'PAYMENT_VALIDATED') {
      updateData.validatedByUserId = user.userId
      updateData.validatedAt = new Date()
      if (data.validationNote) updateData.validationNote = data.validationNote
    }

    const updated = await prisma.sale.update({
      where: { id },
      data: updateData,
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
        customer: { select: { name: true, email: true } },
      },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError('Forbidden', 403)
    console.error('[ADMIN ORDER UPDATE]', err)
    return apiError('Internal server error', 500)
  }
}
