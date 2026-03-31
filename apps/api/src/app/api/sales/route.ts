import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertSubsidiaryAccess, requirePermission } from '@/lib/rbac'
import { checkLowStockAlerts, generateReceiptNumber } from '@/lib/helpers'
import { logAudit } from '@/lib/audit'

const saleItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  costPrice: z.number().min(0),
  discount: z.number().min(0).default(0),
})

const createSaleSchema = z.object({
  subsidiaryId: z.string(),
  items: z.array(saleItemSchema).min(1),
  discount: z.number().min(0).default(0),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'POS']).default('CASH'),
  amountPaid: z.number().min(0),
  notes: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    requirePermission(user, 'view:sales')
    const { searchParams } = new URL(req.url)

    const subsidiaryId = searchParams.get('subsidiaryId')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where = {
      archived: false,
      tenantId: isSuperAdmin(user) ? undefined : user.tenantId!,
      // Salesperson can only see their own sales
      ...(user.role === 'SALESPERSON' ? { userId: user.userId } : {}),
      ...(subsidiaryId
        ? { subsidiaryId }
        : user.role === 'SALESPERSON' && user.subsidiaryId
        ? { subsidiaryId: user.subsidiaryId }
        : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          items: {
            include: { product: { select: { name: true, unit: true } } },
          },
          user: { select: { firstName: true, lastName: true } },
          subsidiary: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ])

    return NextResponse.json({ data: sales, total, page, limit })
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[SALES GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const body = await req.json()
    const data = createSaleSchema.parse(body)

    assertSubsidiaryAccess(user, data.subsidiaryId)

    // Validate products belong to tenant and calculate totals
    const productIds = data.items.map((i) => i.productId)
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: user.tenantId!,
        archived: false,
        status: { in: ['ACTIVE', 'DRAFT'] },
      },
    })

    if (products.length !== productIds.length) {
      return apiError('One or more products not found or inactive', 400)
    }

    // Check stock for GOODS type
    for (const item of data.items) {
      const product = products.find((p) => p.id === item.productId)!
      if (product.type === 'GOODS' && Number(product.quantity) < item.quantity) {
        return apiError(`Insufficient stock for "${product.name}". Available: ${product.quantity}`, 400)
      }
    }

    // Compute totals
    const subtotals = data.items.map((item) => {
      const itemSubtotal = item.quantity * item.unitPrice - item.discount
      return { ...item, subtotal: itemSubtotal }
    })
    const grossTotal = subtotals.reduce((s, i) => s + i.subtotal, 0)
    const totalAmount = Math.max(0, grossTotal - data.discount)

    const sale = await prisma.$transaction(async (tx) => {
      // Generate unique sequential receipt number inside the transaction
      const receiptNumber = await generateReceiptNumber(tx, user.tenantId!)

      // Deduct stock
      for (const item of data.items) {
        const product = products.find((p) => p.id === item.productId)!
        if (product.type === 'GOODS') {
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { decrement: item.quantity } },
          })
        }
      }

      return tx.sale.create({
        data: {
          tenantId: user.tenantId!,
          subsidiaryId: data.subsidiaryId,
          userId: user.userId,
          totalAmount,
          discount: data.discount,
          amountPaid: data.amountPaid,
          paymentMethod: data.paymentMethod,
          receiptNumber,
          notes: data.notes,
          createdBy: user.userId,
          items: {
            create: subtotals.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              costPrice: item.costPrice,
              discount: item.discount,
              subtotal: item.subtotal,
            })),
          },
        },
        include: {
          items: {
            include: { product: { select: { name: true, unit: true } } },
          },
          user: { select: { firstName: true, lastName: true } },
        },
      })
    })

    // Trigger low stock checks asynchronously
    checkLowStockAlerts(user.tenantId!, data.subsidiaryId).catch(console.error)

    await logAudit({
      tenantId: sale.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'sale',
      entityId: sale.id,
      newValues: {
        totalAmount: sale.totalAmount,
        discount: sale.discount,
        amountPaid: sale.amountPaid,
        paymentMethod: sale.paymentMethod,
        receiptNumber: sale.receiptNumber,
        subsidiaryId: sale.subsidiaryId,
        itemsCount: sale.items.length,
      },
      req,
    })

    return NextResponse.json({ data: sale }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if ((err as Error).message?.includes('Forbidden')) return apiError((err as Error).message, 403)
    console.error('[SALES POST]', err)
    return apiError('Internal server error', 500)
  }
}
