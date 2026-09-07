import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { hasPermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'CANCELLED']),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:sales')) return apiError('Forbidden', 403)

    const order = await prisma.customerOrder.findUnique({
      where: { id: params.id },
      include: {
        items: { include: { product: { select: { name: true, unit: true, imageUrl: true, sellingUnit: true, keepingUnit: true } } } },
        subsidiary: { select: { name: true } },
      },
    })

    if (!order) return apiError('Order not found', 404)
    if (order.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    return NextResponse.json({ data: order })
  } catch (err) {
    console.error('[ORDER GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:sales')) return apiError('Forbidden', 403)

    const order = await prisma.customerOrder.findUnique({ where: { id: params.id } })
    if (!order) return apiError('Order not found', 404)
    if (order.tenantId !== user.tenantId) return apiError('Forbidden', 403)

    const body = await req.json()
    const { status } = updateStatusSchema.parse(body)

    const updated = await prisma.customerOrder.update({
      where: { id: params.id },
      data: { status },
    })

    // If status changes to CONFIRMED, deduct stock
    if (status === 'CONFIRMED' && order.status !== 'CONFIRMED') {
      const items = await prisma.customerOrderItem.findMany({ where: { orderId: order.id } })
      for (const item of items) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } })
        if (product && product.type === 'GOODS') {
          await prisma.product.update({
            where: { id: item.productId },
            data: { quantity: { decrement: Number(item.quantity) } },
          })
        }
      }
    }

    await logAudit({
      tenantId: order.tenantId,
      userId: user.userId,
      action: 'UPDATE',
      entity: 'online_order',
      entityId: order.id,
      oldValues: { status: order.status },
      newValues: { status: updated.status },
      req,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[ORDER PATCH]', err)
    return apiError('Internal server error', 500)
  }
}
