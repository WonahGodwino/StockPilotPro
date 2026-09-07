import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handleOptions } from '@/lib/auth'
import { generateReceiptNumber } from '@/lib/helpers'
import { checkLowStockAlerts } from '@/lib/helpers'
import { logger } from '@/lib/logger'

export async function OPTIONS() {
  return handleOptions()
}

function generateTrackingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `SP-${code.slice(0, 4)}-${code.slice(4)}`
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value)
  }
  return response
}

const checkoutSchema = z.object({
  tenantId: z.string(),
  subsidiaryId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive(),
    unitSold: z.string().optional(),
    unitPrice: z.number().min(0),
    costPrice: z.number().min(0),
    discount: z.number().min(0).default(0),
  })).min(1),
  discount: z.number().min(0).default(0),
  currency: z.string().length(3).transform((v) => v.toUpperCase()).default('USD'),
  fxRate: z.number().positive().default(1),
  notes: z.string().optional(),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  shippingAddress: z.object({
    name: z.string(),
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    zip: z.string().optional(),
    country: z.string(),
    phone: z.string().optional(),
  }),
  transactionRef: z.string().min(6).max(180), // Paystack reference
})

/**
 * POST /api/storefront/checkout
 * Public endpoint — creates an online order (without requiring auth)
 * Stock validation is done inside a transaction to prevent overselling.
 * Returns the created sale and a payment reference for the client to verify.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = checkoutSchema.parse(body)

    // Validate tenant + subsidiary exist
    const tenant = await prisma.tenant.findUnique({
      where: { id: data.tenantId },
      select: { id: true, isActive: true },
    })
    if (!tenant?.isActive) {
      return withCors(NextResponse.json({ error: 'Store not available' }, { status: 404 }))
    }

    const subsidiary = await prisma.subsidiary.findFirst({
      where: {
        id: data.subsidiaryId,
        tenantId: data.tenantId,
        archived: false,
        isActive: true,
      },
      select: { id: true },
    })
    if (!subsidiary) {
      return withCors(NextResponse.json({ error: 'Invalid subsidiary' }, { status: 422 }))
    }

    // Validate products
    const productIds = data.items.map((i) => i.productId)
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: data.tenantId,
        archived: false,
        status: { in: ['ACTIVE', 'DRAFT'] },
      },
      select: { id: true, type: true, quantity: true, unit: true },
    })

    if (products.length !== productIds.length) {
      return withCors(NextResponse.json({ error: 'One or more products unavailable' }, { status: 400 }))
    }

    // Find or create customer
    let customer = await prisma.customer.findFirst({
      where: { email: data.customerEmail, tenantId: data.tenantId, archived: false },
      select: { id: true },
    })
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenantId: data.tenantId,
          name: data.customerName,
          email: data.customerEmail,
          phone: data.customerPhone || '',
        },
      })
    }

    // Compute totals
    const subtotals = data.items.map((item) => {
      const subtotal = item.quantity * item.unitPrice - item.discount
      return { ...item, subtotal }
    })
    const grossTotal = subtotals.reduce((s, i) => s + i.subtotal, 0)
    const totalAmount = Math.max(0, grossTotal - data.discount)

    // Idempotency check
    const existing = await prisma.sale.findFirst({
      where: {
        tenantId: data.tenantId,
        OR: [
          { transactionRef: data.transactionRef },
          { syncRef: data.transactionRef },
        ],
      },
    })
    if (existing) {
      return withCors(NextResponse.json({
        data: existing,
        message: 'Order already exists',
      }))
    }

    // Transactional stock deduction + sale creation
    const sale = await prisma.$transaction(async (tx) => {
      // Deduct stock
      for (const item of data.items) {
        const product = products.find((p) => p.id === item.productId)!
        if (product.type === 'GOODS') {
          const current = await tx.product.findUnique({
            where: { id: item.productId },
            select: { quantity: true, unit: true },
          })
          const currentQty = current ? Number(current.quantity) : 0
          if (currentQty < item.quantity) {
            throw new Error(`Insufficient stock. Available: ${currentQty} ${current?.unit || product.unit}`)
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { decrement: item.quantity } },
          })
        }
      }

      const receiptNumber = await generateReceiptNumber(tx, data.tenantId)
      const trackingCode = generateTrackingCode()

      return tx.sale.create({
        data: {
          tenantId: data.tenantId,
          subsidiaryId: data.subsidiaryId,
          userId: '00000000-0000-0000-0000-000000000000', // system user placeholder
          totalAmount,
          discount: data.discount,
          amountPaid: totalAmount,
          paymentMethod: 'ONLINE',
          currency: data.currency,
          fxRate: data.fxRate,
          transactionRef: data.transactionRef,
          syncRef: data.transactionRef,
          receiptNumber,
          notes: data.notes,
          createdBy: 'storefront',
          customerId: customer.id,
          source: 'ONLINE',
          orderStatus: 'PENDING',
          trackingCode,
          trackingStatus: 'PENDING',
          shippingAddress: data.shippingAddress as import('@prisma/client/runtime/library').InputJsonValue,
          items: {
            create: subtotals.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitSold: item.unitSold,
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
        },
      })
    })

    // Async low-stock check
    checkLowStockAlerts(data.tenantId, data.subsidiaryId).catch((err) => {
      logger.error('Low stock alert failed (storefront)', { tenantId: data.tenantId, err })
    })

    return withCors(NextResponse.json({ data: sale }, { status: 201 }))
  } catch (err) {
    if (err instanceof z.ZodError) return withCors(NextResponse.json({ error: err.errors }, { status: 422 }))
    if ((err as Error).message?.startsWith('Insufficient stock')) {
      return withCors(NextResponse.json({ error: (err as Error).message }, { status: 400 }))
    }
    logger.error('Storefront checkout failed', { err })
    console.error('[STOREFRONT CHECKOUT]', err)
    return withCors(NextResponse.json({ error: 'Order could not be processed' }, { status: 500 }))
  }
}
