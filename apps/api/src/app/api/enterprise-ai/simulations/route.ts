import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { isSimulationTypeAllowedForRole } from '@/lib/enterprise-ai-route-policy'

const simulationTypeSchema = z.enum(['PRICE_ADJUSTMENT', 'STOCK_TRANSFER', 'EXPENSE_CAP'])

const postSchema = z.object({
  simulationType: simulationTypeSchema,
  horizonDays: z.number().int().min(7).max(90).optional(),
  priceAdjustment: z.object({
    productId: z.string().min(1),
    percentChange: z.number().min(-30).max(30),
  }).optional(),
  stockTransfer: z.object({
    productId: z.string().min(1),
    fromSubsidiaryId: z.string().min(1),
    toSubsidiaryId: z.string().min(1),
    units: z.number().int().min(1),
  }).optional(),
  expenseCap: z.object({
    subsidiaryId: z.string().min(1).optional(),
    capPercent: z.number().min(1).max(50),
  }).optional(),
})

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function pctDelta(current: number, baseline: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100
  return ((current - baseline) / Math.abs(baseline)) * 100
}

async function runPriceAdjustmentSimulation(args: {
  tenantId: string
  horizonDays: number
  productId: string
  percentChange: number
}) {
  const product = await prisma.product.findFirst({
    where: { id: args.productId, tenantId: args.tenantId, archived: false },
    select: {
      id: true,
      name: true,
      sellingPrice: true,
      costPrice: true,
      subsidiaryId: true,
    },
  })
  if (!product) throw new Error('Product not found for price adjustment simulation')

  const since = new Date(Date.now() - args.horizonDays * 24 * 60 * 60 * 1000)
  const soldRows = await prisma.saleItem.findMany({
    where: {
      productId: product.id,
      sale: {
        tenantId: args.tenantId,
        archived: false,
        createdAt: { gte: since },
      },
    },
    select: { quantity: true },
  })

  const soldUnits = soldRows.reduce((sum, row) => sum + toNumber(row.quantity), 0)
  const currentPrice = toNumber(product.sellingPrice)
  const cost = toNumber(product.costPrice)
  const proposedPrice = currentPrice * (1 + args.percentChange / 100)

  const revenueBaseline = soldUnits * currentPrice
  const revenueProjected = soldUnits * proposedPrice
  const grossMarginBaseline = soldUnits * (currentPrice - cost)
  const grossMarginProjected = soldUnits * (proposedPrice - cost)

  return {
    simulationType: 'PRICE_ADJUSTMENT',
    productId: product.id,
    productName: product.name,
    horizonDays: args.horizonDays,
    assumptions: {
      constantDemandUnits: soldUnits,
      percentChange: args.percentChange,
      currentPrice,
      proposedPrice,
    },
    outputs: {
      revenueBaseline,
      revenueProjected,
      revenueDelta: revenueProjected - revenueBaseline,
      revenueDeltaPct: pctDelta(revenueProjected, revenueBaseline),
      grossMarginBaseline,
      grossMarginProjected,
      grossMarginDelta: grossMarginProjected - grossMarginBaseline,
      grossMarginDeltaPct: pctDelta(grossMarginProjected, grossMarginBaseline),
    },
  }
}

async function runStockTransferSimulation(args: {
  tenantId: string
  productId: string
  fromSubsidiaryId: string
  toSubsidiaryId: string
  units: number
}) {
  const sourceProduct = await prisma.product.findFirst({
    where: {
      id: args.productId,
      tenantId: args.tenantId,
      subsidiaryId: args.fromSubsidiaryId,
      archived: false,
    },
    select: {
      id: true,
      name: true,
      quantity: true,
      lowStockThreshold: true,
      subsidiaryId: true,
    },
  })

  if (!sourceProduct) throw new Error('Source product not found for stock transfer simulation')

  const targetProduct = await prisma.product.findFirst({
    where: {
      tenantId: args.tenantId,
      subsidiaryId: args.toSubsidiaryId,
      name: sourceProduct.name,
      archived: false,
    },
    select: {
      id: true,
      name: true,
      quantity: true,
      lowStockThreshold: true,
      subsidiaryId: true,
    },
  })

  const sourceQty = toNumber(sourceProduct.quantity)
  const sourceThreshold = toNumber(sourceProduct.lowStockThreshold)
  const targetQty = toNumber(targetProduct?.quantity)
  const targetThreshold = toNumber(targetProduct?.lowStockThreshold)

  if (args.units > sourceQty) {
    throw new Error('Transfer units exceed source stock on hand')
  }

  const sourceAfter = sourceQty - args.units
  const targetAfter = targetQty + args.units

  const sourceRiskBefore = sourceQty <= sourceThreshold ? 1 : 0
  const sourceRiskAfter = sourceAfter <= sourceThreshold ? 1 : 0
  const targetRiskBefore = targetQty <= targetThreshold ? 1 : 0
  const targetRiskAfter = targetAfter <= targetThreshold ? 1 : 0

  return {
    simulationType: 'STOCK_TRANSFER',
    productId: sourceProduct.id,
    productName: sourceProduct.name,
    assumptions: {
      transferUnits: args.units,
      fromSubsidiaryId: args.fromSubsidiaryId,
      toSubsidiaryId: args.toSubsidiaryId,
    },
    outputs: {
      source: {
        stockBefore: sourceQty,
        stockAfter: sourceAfter,
        lowStockThreshold: sourceThreshold,
        stockRiskBefore: sourceRiskBefore,
        stockRiskAfter: sourceRiskAfter,
      },
      target: {
        stockBefore: targetQty,
        stockAfter: targetAfter,
        lowStockThreshold: targetThreshold,
        stockRiskBefore: targetRiskBefore,
        stockRiskAfter: targetRiskAfter,
      },
      netRiskDelta: (sourceRiskAfter + targetRiskAfter) - (sourceRiskBefore + targetRiskBefore),
    },
  }
}

async function runExpenseCapSimulation(args: {
  tenantId: string
  horizonDays: number
  subsidiaryId?: string
  capPercent: number
}) {
  const since = new Date(Date.now() - args.horizonDays * 24 * 60 * 60 * 1000)
  const aggregate = await prisma.expense.aggregate({
    where: {
      tenantId: args.tenantId,
      archived: false,
      date: { gte: since },
      ...(args.subsidiaryId ? { subsidiaryId: args.subsidiaryId } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  })

  const baseline = toNumber(aggregate._sum.amount)
  const projected = baseline * (1 - args.capPercent / 100)
  const savings = baseline - projected

  return {
    simulationType: 'EXPENSE_CAP',
    horizonDays: args.horizonDays,
    assumptions: {
      subsidiaryId: args.subsidiaryId || null,
      capPercent: args.capPercent,
      expenseCount: aggregate._count._all,
    },
    outputs: {
      expenseBaseline: baseline,
      expenseProjected: projected,
      savingsAmount: savings,
      savingsPercent: pctDelta(savings, baseline),
    },
  }
}

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const body = await req.json()
    const payload = postSchema.parse(body)

    if (!isSimulationTypeAllowedForRole(user.role, payload.simulationType)) {
      return apiError('Forbidden: simulation execution is restricted to admin roles', 403)
    }

    const requiredFeatures: Record<z.infer<typeof simulationTypeSchema>, string[]> = {
      PRICE_ADJUSTMENT: ['AI_PRICING_MARGIN_ADVISOR'],
      STOCK_TRANSFER: ['AI_REORDER_ADVISOR'],
      EXPENSE_CAP: ['AI_EXPENSE_RISK_ALERTS'],
    }

    const access = await requireEnterpriseAiAccess(user, requiredFeatures[payload.simulationType])
    const horizonDays = payload.horizonDays || 30

    const result = payload.simulationType === 'PRICE_ADJUSTMENT'
      ? await runPriceAdjustmentSimulation({
          tenantId: access.tenantId,
          horizonDays,
          productId: payload.priceAdjustment?.productId || '',
          percentChange: payload.priceAdjustment?.percentChange || 0,
        })
      : payload.simulationType === 'STOCK_TRANSFER'
      ? await runStockTransferSimulation({
          tenantId: access.tenantId,
          productId: payload.stockTransfer?.productId || '',
          fromSubsidiaryId: payload.stockTransfer?.fromSubsidiaryId || '',
          toSubsidiaryId: payload.stockTransfer?.toSubsidiaryId || '',
          units: payload.stockTransfer?.units || 0,
        })
      : await runExpenseCapSimulation({
          tenantId: access.tenantId,
          horizonDays,
          subsidiaryId: payload.expenseCap?.subsidiaryId,
          capPercent: payload.expenseCap?.capPercent || 0,
        })

    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId: access.tenantId,
        metricKey: 'simulation_run',
        metricValue: 1,
        dimensions: {
          simulationType: payload.simulationType,
          horizonDays,
        },
      },
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_SIMULATION_RUN',
      entity: 'EnterpriseAiSimulation',
      newValues: {
        simulationType: payload.simulationType,
        horizonDays,
      },
      req,
    })

    return NextResponse.json({ data: result })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI SIMULATIONS POST]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}
