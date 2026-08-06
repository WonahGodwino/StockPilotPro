import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, assertSubsidiaryAccess, requirePermission } from '@/lib/rbac'
import { checkLowStockAlerts, generateReceiptNumber } from '@/lib/helpers'
import { logAudit } from '@/lib/audit'
import { assertTenantHasActiveSubscription } from '@/lib/subscription-enforcement'
import { logger } from '@/lib/logger'

const MAX_RECEIPT_RETRIES = 3

const saleItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().positive(),
  unitSold: z.string().optional(),
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
  currency: z.string().length(3).transform((v) => v.toUpperCase()).default('USD'),
  fxRate: z.number().positive().default(1),
  syncRef: z.string().min(6).max(120).optional(),
  transactionRef: z.string().min(6).max(180).optional(),
  notes: z.string().optional(),
  customerId: z.string().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function withCors(response: NextResponse): NextResponse {
  const headers = corsHeaders()
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
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
    const requestedTenantId = searchParams.get('tenantId') || undefined
    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return withCors(apiError('No tenant context for this account. Provide tenantId.', 400))
    }

    const where = {
      archived: false,
      tenantId,
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

    return withCors(NextResponse.json({ data: sales, total, page, limit }))
  } catch (err) {
    if ((err as Error).message?.includes('Forbidden')) return withCors(apiError((err as Error).message, 403))
    console.error('[SALES GET]', err)
    return withCors(apiError('Internal server error', 500))
  }
}

export async function POST(req: NextRequest) {
  let tenantId: string | undefined
  let idempotencyRef: string | undefined
  try {
    const user = authenticate(req)
    tenantId = user.tenantId || undefined

    // ── Subscription enforcement ────────────────────────────────────────
    if (user.tenantId) {
      await assertTenantHasActiveSubscription(user.tenantId)
    }

    const body = await req.json()
    const data = createSaleSchema.parse(body)
    const syncRef = data.syncRef?.trim() || undefined
    const transactionRef = data.transactionRef?.trim() || undefined
    idempotencyRef = transactionRef || syncRef

    assertSubsidiaryAccess(user, data.subsidiaryId)

    const subsidiary = await prisma.subsidiary.findFirst({
      where: {
        id: data.subsidiaryId,
        tenantId: user.tenantId!,
        archived: false,
        isActive: true,
      },
      select: { id: true },
    })
    if (!subsidiary) {
      return withCors(apiError('Invalid subsidiary selected', 422))
    }

    // ── Idempotency guard ───────────────────────────────────────────────
    if (idempotencyRef) {
      const existing = await prisma.sale.findFirst({
        where: {
          tenantId: user.tenantId!,
          OR: [
            { transactionRef: idempotencyRef },
            { syncRef: idempotencyRef },
          ],
        },
        include: {
          items: {
            include: { product: { select: { name: true, unit: true } } },
          },
          user: { select: { firstName: true, lastName: true } },
        },
      })
      if (existing) {
        return withCors(NextResponse.json({ data: existing }))
      }
    }

    // ── Pre-validate product existence (lightweight) ────────────────────
    const productIds = data.items.map((i) => i.productId)
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: user.tenantId!,
        archived: false,
        status: { in: ['ACTIVE', 'DRAFT'] },
      },
      select: {
        id: true,
        type: true,
        quantity: true,
        unit: true,
      },
    })

    if (products.length !== productIds.length) {
      return withCors(apiError('One or more products not found or inactive', 400))
    }

    // Map Decimal → number for the transaction helper
    const productSnapshots = products.map((p) => ({
      id: p.id,
      type: p.type,
      quantity: Number(p.quantity),
      unit: p.unit,
    }))

    // ── Compute subtotals and totals ────────────────────────────────────
    const subtotals = data.items.map((item) => {
      const itemSubtotal = item.quantity * item.unitPrice - item.discount
      return { ...item, subtotal: itemSubtotal }
    })
    const grossTotal = subtotals.reduce((s, i) => s + i.subtotal, 0)
    const totalAmount = Math.max(0, grossTotal - data.discount)

    // ── Pre-validate customer ───────────────────────────────────────────
    let resolvedCustomerId: string | undefined
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId: user.tenantId!, archived: false },
        select: { id: true },
      })
      if (!customer) {
        return withCors(apiError('Customer not found', 422))
      }
      resolvedCustomerId = customer.id
    }

    // ── Transaction with retry for receipt number collision ─────────────
    let retries = 0
    let sale: Awaited<ReturnType<typeof executeSaleTransaction>> | undefined

    while (retries <= MAX_RECEIPT_RETRIES) {
      try {
        sale = await executeSaleTransaction({
          tx: prisma,
          tenantId: user.tenantId!,
          subsidiaryId: data.subsidiaryId,
          userId: user.userId,
          totalAmount,
          discount: data.discount,
          amountPaid: data.amountPaid,
          paymentMethod: data.paymentMethod,
          currency: data.currency,
          fxRate: data.fxRate,
          syncRef,
          transactionRef,
          notes: data.notes,
          customerId: resolvedCustomerId,
          items: data.items,
          subtotals,
          products: productSnapshots,
        })
        break
      } catch (err) {
        // P2002 = unique constraint violation — only retry if it's receiptNumber collision
        if ((err as { code?: string }).code === 'P2002' && retries < MAX_RECEIPT_RETRIES) {
          retries++
          logger.warn('Receipt number collision, retrying', {
            tenantId: user.tenantId!,
            attempt: retries,
            maxRetries: MAX_RECEIPT_RETRIES,
          })
          continue
        }
        throw err
      }
    }

    // ── Post-sale async tasks ───────────────────────────────────────────
    checkLowStockAlerts(user.tenantId!, data.subsidiaryId).catch((err) => {
      logger.error('Low stock alert failed', {
        tenantId: user.tenantId!,
        subsidiaryId: data.subsidiaryId,
        err,
      })
    })

    await logAudit({
      tenantId: sale!.tenantId,
      userId: user.userId,
      action: 'CREATE',
      entity: 'sale',
      entityId: sale!.id,
      newValues: {
        totalAmount: sale!.totalAmount,
        discount: sale!.discount,
        amountPaid: sale!.amountPaid,
        paymentMethod: sale!.paymentMethod,
        receiptNumber: sale!.receiptNumber,
        currency: sale!.currency,
        fxRate: sale!.fxRate,
        syncRef: sale!.syncRef,
        transactionRef: sale!.transactionRef,
        subsidiaryId: sale!.subsidiaryId,
        itemsCount: sale!.items.length,
      },
      req,
    })

    return withCors(NextResponse.json({ data: sale }, { status: 201 }))
  } catch (err) {
    if (err instanceof z.ZodError) return withCors(NextResponse.json({ error: err.errors }, { status: 422 }))
    if ((err as Error).message?.includes('Forbidden')) return withCors(apiError((err as Error).message, 403))
    if ((err as Error).message?.includes('Subscription')) return withCors(apiError((err as Error).message, 402))
    if ((err as { code?: string }).code === 'P2003') return withCors(apiError('Invalid subsidiary selected', 422))
    if ((err as { code?: string }).code === 'P2002') {
      // If we exhausted retries for receiptNumber or it's an idempotency collision
      if (idempotencyRef && tenantId) {
        const existing = await prisma.sale.findFirst({
          where: {
            tenantId,
            OR: [
              { transactionRef: idempotencyRef },
              { syncRef: idempotencyRef },
            ],
          },
          include: {
            items: {
              include: { product: { select: { name: true, unit: true } } },
            },
            user: { select: { firstName: true, lastName: true } },
          },
        })
        if (existing) return withCors(NextResponse.json({ data: existing }))
      }
      return withCors(apiError('A duplicate record was detected. Please retry.', 409))
    }
    // Re-throw stock insufficiency errors from inside the transaction
    if ((err as Error).message?.startsWith('Insufficient stock')) {
      return withCors(apiError((err as Error).message, 400))
    }
    logger.error('Sale creation failed', {
      tenantId: tenantId ?? 'unknown',
      err,
    })
    console.error('[SALES POST]', err)
    return withCors(apiError('Internal server error', 500))
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Transaction helper — runs stock validation + deduction atomically
// ──────────────────────────────────────────────────────────────────────────────

interface SaleTransactionParams {
  tx: typeof prisma
  tenantId: string
  subsidiaryId: string
  userId: string
  totalAmount: number
  discount: number
  amountPaid: number
  paymentMethod: 'CASH' | 'TRANSFER' | 'POS'
  currency: string
  fxRate: number
  syncRef?: string
  transactionRef?: string
  notes?: string
  customerId?: string
  items: { productId: string; quantity: number; unitSold?: string; unitPrice: number; costPrice: number; discount: number }[]
  subtotals: { productId: string; quantity: number; unitSold?: string; unitPrice: number; costPrice: number; discount: number; subtotal: number }[]
  products: { id: string; type: string; quantity: number; unit: string }[]
}

async function executeSaleTransaction(params: SaleTransactionParams) {
  const {
    tenantId, subsidiaryId, userId, totalAmount, discount, amountPaid,
    paymentMethod, currency, fxRate, syncRef, transactionRef, notes,
    customerId, items, subtotals, products,
  } = params

  return prisma.$transaction(async (tx) => {
    // ── Stock validation + deduction (atomic, inside transaction) ──────
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId)!
      if (product.type === 'GOODS') {
        // Re-read current quantity inside transaction to prevent race conditions
        const current = await tx.product.findUnique({
          where: { id: item.productId },
          select: { quantity: true, unit: true },
        })
        const currentQty = current ? Number(current.quantity) : 0
        const currentUnit = current?.unit || product.unit
        if (currentQty < item.quantity) {
          throw new Error(
            `Insufficient stock for "${product.type === 'GOODS' ? 'product' : 'item'}". ` +
            `Available: ${currentQty} ${currentUnit}`
          )
        }

        await tx.product.update({
          where: { id: item.productId },
          data: { quantity: { decrement: item.quantity } },
        })
      }
    }

    // ── Generate receipt number ────────────────────────────────────────
    const receiptNumber = await generateReceiptNumber(tx, tenantId)

    // ── Create sale with items ─────────────────────────────────────────
    const createdSale = await tx.sale.create({
      data: {
        tenantId,
        subsidiaryId,
        userId,
        totalAmount,
        discount,
        amountPaid,
        paymentMethod,
        currency,
        fxRate,
        syncRef,
        transactionRef,
        receiptNumber,
        notes,
        createdBy: userId,
        customerId,
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
        user: { select: { firstName: true, lastName: true } },
      },
    })

    // ── Loyalty accrual ────────────────────────────────────────────────
    if (customerId) {
      const earnedPoints = Math.floor(totalAmount)
      const customer = await tx.customer.findFirst({
        where: { id: customerId },
        select: { loyaltyPoints: true },
      })
      if (customer && earnedPoints > 0) {
        const balanceBefore = customer.loyaltyPoints
        const balanceAfter = balanceBefore + earnedPoints
        await tx.customer.update({
          where: { id: customerId },
          data: {
            loyaltyPoints: balanceAfter,
            totalSpend: { increment: totalAmount },
            visitCount: { increment: 1 },
            lastVisitedAt: new Date(),
          },
        })
        await tx.loyaltyLedger.create({
          data: {
            tenantId,
            customerId,
            saleId: createdSale.id,
            type: 'EARN',
            points: earnedPoints,
            balanceBefore,
            balanceAfter,
            note: `Earned from sale ${receiptNumber}`,
            createdByUserId: userId,
          },
        })
      } else if (customer) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            totalSpend: { increment: totalAmount },
            visitCount: { increment: 1 },
            lastVisitedAt: new Date(),
          },
        })
      }
    }

    return createdSale
  })
}
