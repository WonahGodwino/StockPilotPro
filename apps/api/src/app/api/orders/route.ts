import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { hasPermission } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

const createOrderSchema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),
  subsidiaryId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
  })).min(1),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:sales')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status') || undefined
    const subsidiaryId = searchParams.get('subsidiaryId') || undefined
    const search = searchParams.get('search') || undefined

    const where = {
      tenantId: user.tenantId!,
      ...(status ? { status: status as any } : {}),
      ...(subsidiaryId ? { subsidiaryId } : user.subsidiaryId ? { subsidiaryId: user.subsidiaryId } : {}),
      ...(search ? {
        OR: [
          { customerName: { contains: search, mode: 'insensitive' as const } },
          { customerPhone: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    }

    const [orders, total] = await Promise.all([
      prisma.customerOrder.findMany({
        where,
        include: {
          items: { include: { product: { select: { name: true, unit: true, imageUrl: true, sellingUnit: true } } } },
          subsidiary: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customerOrder.count({ where }),
    ])

    return NextResponse.json({ data: orders, total, page, limit })
  } catch (err) {
    console.error('[ORDERS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)

    const body = await req.json()
    const data = createOrderSchema.parse(body)

    // Validate products
    const productIds = data.items.map((i) => i.productId)
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: user.tenantId!,
        archived: false,
        status: 'ACTIVE',
      },
    })

    if (products.length !== productIds.length) {
      return apiError('One or more products not found or unavailable', 400)
    }

    // Check stock
    for (const item of data.items) {
      const product = products.find((p) => p.id === item.productId)!
      if (product.type === 'GOODS' && Number(product.quantity) < item.quantity) {
        return apiError(`Insufficient stock for "${product.name}". Available: ${Number(product.quantity)}`, 400)
      }
    }

    // Compute totals
    const itemsWithPrices = data.items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!
      const unitPrice = Number(product.sellingPrice)
      return { ...item, unitPrice, subtotal: item.quantity * unitPrice }
    })
    const totalAmount = itemsWithPrices.reduce((s, i) => s + i.subtotal, 0)

    const order = await prisma.customerOrder.create({
      data: {
        tenantId: user.tenantId!,
        subsidiaryId: data.subsidiaryId || null,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        notes: data.notes,
        totalAmount,
        items: {
          create: itemsWithPrices.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          })),
        },
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true, imageUrl: true } } } },
      },
    })

    await logAudit({
      tenantId: order.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'online_order',
      entityId: order.id,
      newValues: { customerName: order.customerName, totalAmount: order.totalAmount, status: order.status },
      req,
    })

    return NextResponse.json({ data: order }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    console.error('[ORDERS POST]', err)
    return apiError('Internal server error', 500)
  }
}
