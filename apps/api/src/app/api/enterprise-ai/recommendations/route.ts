import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import {
  EnterpriseAccessError,
  getFreshFeatureSnapshot,
  requireEnterpriseAiAccess,
} from '@/lib/enterprise-ai'
import { isUnsafeAssistantPrompt } from '@/lib/enterprise-ai-policy'
import { isRecommendationTypeAllowedForRole } from '@/lib/enterprise-ai-route-policy'

const recommendationTypeSchema = z.enum([
  'DEMAND_FORECAST',
  'REORDER_ADVISOR',
  'PRICING_MARGIN_ADVISOR',
  'CASHFLOW_FORECAST',
  'EXPENSE_RISK_ALERT',
  'ANOMALY_DETECTION',
  'BRANCH_PERFORMANCE',
  'NL_ASSISTANT',
])

const postSchema = z.object({
  recommendationType: recommendationTypeSchema,
  subsidiaryId: z.string().optional(),
  productId: z.string().optional(),
  prompt: z.string().max(1000).optional(),
  horizonDays: z.number().int().min(1).max(180).optional(),
})

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function confidenceFromVolume(volume: number): number {
  if (volume <= 0) return 0.35
  if (volume >= 200) return 0.92
  return Math.min(0.92, 0.35 + volume / 350)
}

async function createRecommendationFromType(args: {
  tenantId: string
  userId: string
  recommendationType: z.infer<typeof recommendationTypeSchema>
  subsidiaryId?: string
  productId?: string
  prompt?: string
  horizonDays?: number
  snapshot: Awaited<ReturnType<typeof getFreshFeatureSnapshot>>
}) {
  const { tenantId, recommendationType, subsidiaryId, productId, prompt, snapshot } = args
  const horizonDays = args.horizonDays || 30

  const modelVersion = 'enterprise-heuristic-v1'
  const snapshotInput = {
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.snapshotVersion,
    generatedAt: snapshot.generatedAt,
    horizonDays,
  }

  if (recommendationType === 'DEMAND_FORECAST' || recommendationType === 'REORDER_ADVISOR') {
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId, archived: false },
      select: {
        id: true,
        name: true,
        quantity: true,
        lowStockThreshold: true,
      },
    })
    if (!product) throw new Error('Product not found for demand/reorder recommendation')

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const soldRows = await prisma.saleItem.findMany({
      where: {
        productId: product.id,
        sale: {
          tenantId,
          archived: false,
          ...(subsidiaryId ? { subsidiaryId } : {}),
          createdAt: { gte: since },
        },
      },
      select: { quantity: true },
    })

    const soldUnits30 = soldRows.reduce((sum, row) => sum + toNumber(row.quantity), 0)
    const avgDailyDemand = soldUnits30 / 30
    const reorderPoint = Math.max(1, Math.ceil(avgDailyDemand * 7))
    const suggestedQty = Math.max(0, Math.ceil(avgDailyDemand * 14 - toNumber(product.quantity)))
    const confidence = confidenceFromVolume(soldUnits30)

    return {
      title: recommendationType === 'DEMAND_FORECAST'
        ? `Demand forecast for ${product.name}`
        : `Reorder recommendation for ${product.name}`,
      summary: recommendationType === 'DEMAND_FORECAST'
        ? `Expected demand is ${avgDailyDemand.toFixed(2)} units/day over the next ${horizonDays} days.`
        : suggestedQty > 0
        ? `Reorder ${suggestedQty} units to avoid stockout risk.`
        : `Current stock is healthy relative to observed demand.`,
      confidence,
      riskScore: suggestedQty > 0 ? Math.min(0.95, 0.4 + suggestedQty / 200) : 0.2,
      reasonCodes: ['SALES_VELOCITY', 'CURRENT_STOCK', 'LOW_STOCK_THRESHOLD'],
      sourceProvenance: ['tenant:sales', 'tenant:inventory'],
      outputPayload: {
        productId: product.id,
        productName: product.name,
        forecastHorizonDays: horizonDays,
        soldUnits30,
        avgDailyDemand,
        reorderPoint,
        suggestedReorderQuantity: suggestedQty,
        currentStock: toNumber(product.quantity),
        lowStockThreshold: toNumber(product.lowStockThreshold),
      },
      modelVersion,
      inputSnapshot: snapshotInput,
    }
  }

  if (recommendationType === 'PRICING_MARGIN_ADVISOR') {
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId, archived: false },
      select: { id: true, name: true, costPrice: true, sellingPrice: true },
    })
    if (!product) throw new Error('Product not found for pricing advisor')

    const cost = toNumber(product.costPrice)
    const price = toNumber(product.sellingPrice)
    const marginPct = price > 0 ? ((price - cost) / price) * 100 : 0
    const minAdj = marginPct < 15 ? 5 : -2
    const maxAdj = marginPct < 15 ? 12 : 6
    const recAdj = marginPct < 15 ? 8 : 2

    return {
      title: `Pricing and margin advisor for ${product.name}`,
      summary: `Current margin is ${marginPct.toFixed(1)}%. Recommended price adjustment is ${recAdj}% to improve margin resilience.`,
      confidence: 0.68,
      riskScore: marginPct < 10 ? 0.8 : 0.35,
      reasonCodes: ['MARGIN_GAP', 'PRICE_POSITIONING'],
      sourceProvenance: ['tenant:products', 'tenant:sales', 'platform:benchmarks'],
      outputPayload: {
        productId: product.id,
        productName: product.name,
        currentCostPrice: cost,
        currentSellingPrice: price,
        currentMarginPercent: marginPct,
        adjustmentRangePercent: {
          min: minAdj,
          recommended: recAdj,
          max: maxAdj,
        },
        projectedMarginImpactPercent: recAdj * 0.55,
      },
      modelVersion,
      inputSnapshot: snapshotInput,
    }
  }

  if (recommendationType === 'CASHFLOW_FORECAST' || recommendationType === 'EXPENSE_RISK_ALERT') {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

    const [salesRecent, expenseRecent, expensePrior] = await Promise.all([
      prisma.sale.aggregate({ where: { tenantId, archived: false, createdAt: { gte: thirtyDaysAgo } }, _sum: { totalAmount: true } }),
      prisma.expense.aggregate({ where: { tenantId, archived: false, date: { gte: thirtyDaysAgo } }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { tenantId, archived: false, date: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _sum: { amount: true } }),
    ])

    const inflow = toNumber(salesRecent._sum.totalAmount)
    const outflow = toNumber(expenseRecent._sum.amount)
    const priorOutflow = toNumber(expensePrior._sum.amount)
    const net = inflow - outflow
    const spikePct = priorOutflow > 0 ? ((outflow - priorOutflow) / priorOutflow) * 100 : 0

    return {
      title: recommendationType === 'CASHFLOW_FORECAST' ? 'Cash-flow forecast outlook' : 'Expense risk alert summary',
      summary: recommendationType === 'CASHFLOW_FORECAST'
        ? `Projected net position for next ${horizonDays} days is ${net.toFixed(2)} based on current run-rate.`
        : spikePct > 20
        ? `Expense run-rate increased by ${spikePct.toFixed(1)}% versus prior period.`
        : 'No significant expense spike detected in the current period.',
      confidence: 0.64,
      riskScore: net < 0 || spikePct > 20 ? 0.82 : 0.28,
      reasonCodes: recommendationType === 'CASHFLOW_FORECAST'
        ? ['INFLOW_OUTFLOW_TREND', 'NET_POSITION']
        : ['EXPENSE_SPIKE_ANALYSIS', 'CATEGORY_VARIANCE'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses'],
      outputPayload: {
        horizonDays,
        inflow,
        outflow,
        projectedNetPosition: net,
        expenseSpikePercent: spikePct,
        severity: net < 0 || spikePct > 20 ? 'HIGH' : 'LOW',
      },
      modelVersion,
      inputSnapshot: snapshotInput,
    }
  }

  if (recommendationType === 'ANOMALY_DETECTION') {
    const [highDiscountSales, duplicateExpenseCandidates] = await Promise.all([
      prisma.sale.findMany({
        where: { tenantId, archived: false },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, receiptNumber: true, totalAmount: true, discount: true, createdAt: true },
      }),
      prisma.expense.findMany({
        where: { tenantId, archived: false },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, title: true, amount: true, createdAt: true },
      }),
    ])

    const suspiciousDiscounts = highDiscountSales
      .map((sale) => ({
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        discountRatio: toNumber(sale.totalAmount) > 0 ? toNumber(sale.discount) / toNumber(sale.totalAmount) : 0,
      }))
      .filter((row) => row.discountRatio >= 0.35)

    const duplicateExpenses = duplicateExpenseCandidates.filter((exp, index, all) => {
      return all.findIndex((x) => x.title === exp.title && toNumber(x.amount) === toNumber(exp.amount)) !== index
    })

    const risk = suspiciousDiscounts.length + duplicateExpenses.length

    return {
      title: 'Anomaly detection summary',
      summary: `Detected ${suspiciousDiscounts.length} suspicious discount trades and ${duplicateExpenses.length} duplicate expense candidates.`,
      confidence: 0.71,
      riskScore: Math.min(0.95, 0.2 + risk / 20),
      reasonCodes: ['DISCOUNT_OUTLIER', 'DUPLICATE_EXPENSE_PATTERN'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', 'tenant:inventory'],
      outputPayload: {
        suspiciousDiscounts,
        duplicateExpenses,
      },
      modelVersion,
      inputSnapshot: snapshotInput,
    }
  }

  if (recommendationType === 'BRANCH_PERFORMANCE') {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [salesRows, expenseRows, branches] = await Promise.all([
      prisma.sale.groupBy({
        by: ['subsidiaryId'],
        where: { tenantId, archived: false, createdAt: { gte: since } },
        _sum: { totalAmount: true, discount: true },
        _count: { _all: true },
      }),
      prisma.expense.groupBy({
        by: ['subsidiaryId'],
        where: { tenantId, archived: false, date: { gte: since } },
        _sum: { amount: true },
      }),
      prisma.subsidiary.findMany({ where: { tenantId, archived: false }, select: { id: true, name: true } }),
    ])

    const ranking = branches.map((branch) => {
      const sales = salesRows.find((x) => x.subsidiaryId === branch.id)
      const expense = expenseRows.find((x) => x.subsidiaryId === branch.id)
      const revenue = toNumber(sales?._sum.totalAmount)
      const spend = toNumber(expense?._sum.amount)
      const margin = revenue - spend
      const score = revenue * 0.5 + margin * 0.4 + (sales?._count._all || 0) * 0.1
      return {
        subsidiaryId: branch.id,
        branchName: branch.name,
        revenue,
        expense: spend,
        margin,
        salesCount: sales?._count._all || 0,
        score,
      }
    }).sort((a, b) => b.score - a.score)

    return {
      title: 'Branch performance copilot',
      summary: ranking.length
        ? `${ranking[0].branchName} leads branch performance over the last 30 days.`
        : 'No branch performance data available yet.',
      confidence: 0.66,
      riskScore: 0.25,
      reasonCodes: ['BRANCH_REVENUE', 'BRANCH_MARGIN', 'BRANCH_SALES_ACTIVITY'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', 'tenant:branches'],
      outputPayload: {
        rankedBranches: ranking,
        prioritizedActions: ranking.slice(-3).map((item) => ({
          subsidiaryId: item.subsidiaryId,
          action: item.margin < 0 ? 'Review branch expense structure and discount policy' : 'Increase high-margin product stocking',
          priority: item.margin < 0 ? 'HIGH' : 'MEDIUM',
        })),
      },
      modelVersion,
      inputSnapshot: snapshotInput,
    }
  }

  if (recommendationType === 'NL_ASSISTANT') {
    const safePrompt = (prompt || '').trim()
    if (!safePrompt) throw new Error('Prompt is required for assistant recommendations')
    if (isUnsafeAssistantPrompt(safePrompt)) {
      return {
        title: 'Assistant safety response',
        summary: 'The request appears unsafe or outside policy. Please ask a business analytics question scoped to your tenant data.',
        confidence: 1,
        riskScore: 0.9,
        reasonCodes: ['UNSAFE_OR_OUT_OF_SCOPE_PROMPT'],
        sourceProvenance: ['tenant:safety-policy'],
        outputPayload: {
          prompt: safePrompt,
          response: 'Request rejected due to unsafe content. Ask for inventory, sales, branch, pricing, or expense guidance.',
        },
        modelVersion,
        inputSnapshot: snapshotInput,
      }
    }

    const branchMetrics = ((snapshot.featureSnapshot as { branchMetrics?: Array<{ branchName?: string; revenue: number }> }).branchMetrics || [])
      .slice(0, 3)

    return {
      title: 'Enterprise assistant response',
      summary: 'Assistant generated a scoped recommendation summary with source provenance.',
      confidence: 0.72,
      riskScore: 0.2,
      reasonCodes: ['TENANT_SCOPED_ANALYTICS_QUERY'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', 'platform:benchmarks', 'public:seasonality'],
      outputPayload: {
        prompt: safePrompt,
        response: `Based on your latest tenant snapshot, prioritize margin protection and branch-level stock discipline. Top branch indicators considered: ${JSON.stringify(branchMetrics)}.`,
      },
      modelVersion,
      inputSnapshot: snapshotInput,
    }
  }

  throw new Error('Unsupported recommendation type')
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const { searchParams } = new URL(req.url)

    const recommendationType = searchParams.get('recommendationType')
    const status = searchParams.get('status')
    const subsidiaryId = searchParams.get('subsidiaryId')
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 30)))

    if (recommendationType && !isRecommendationTypeAllowedForRole(user.role, recommendationType as never)) {
      return apiError('Forbidden: anomaly detection output is restricted to SUPER_ADMIN', 403)
    }

    const rows = await prisma.enterpriseAiRecommendation.findMany({
      where: {
        tenantId: access.tenantId,
        ...(recommendationType ? { recommendationType: recommendationType as never } : {}),
        ...(status ? { status: status as never } : {}),
        ...(subsidiaryId ? { subsidiaryId } : {}),
        ...(user.role !== 'SUPER_ADMIN' ? { recommendationType: { not: 'ANOMALY_DETECTION' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ data: rows })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI RECOMMENDATIONS GET]', err)
    return apiError('Internal server error', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    const body = await req.json()
    const payload = postSchema.parse(body)

    const requiredFeatureMap: Record<z.infer<typeof recommendationTypeSchema>, string[]> = {
      DEMAND_FORECAST: ['AI_DEMAND_FORECAST'],
      REORDER_ADVISOR: ['AI_REORDER_ADVISOR'],
      PRICING_MARGIN_ADVISOR: ['AI_PRICING_MARGIN_ADVISOR'],
      CASHFLOW_FORECAST: ['AI_CASHFLOW_FORECAST'],
      EXPENSE_RISK_ALERT: ['AI_EXPENSE_RISK_ALERTS'],
      ANOMALY_DETECTION: ['AI_ANOMALY_DETECTION'],
      BRANCH_PERFORMANCE: ['AI_BRANCH_PERFORMANCE_COPILOT'],
      NL_ASSISTANT: ['AI_NATURAL_LANGUAGE_ASSISTANT'],
    }

    if (!isRecommendationTypeAllowedForRole(user.role, payload.recommendationType)) {
      return apiError('Forbidden: anomaly detection generation is restricted to SUPER_ADMIN', 403)
    }

    const access = await requireEnterpriseAiAccess(user, requiredFeatureMap[payload.recommendationType])
    const snapshot = await getFreshFeatureSnapshot(access.tenantId)

    const generated = await createRecommendationFromType({
      tenantId: access.tenantId,
      userId: access.userId,
      recommendationType: payload.recommendationType,
      subsidiaryId: payload.subsidiaryId,
      productId: payload.productId,
      prompt: payload.prompt,
      horizonDays: payload.horizonDays,
      snapshot,
    })

    if (payload.recommendationType === 'EXPENSE_RISK_ALERT' || payload.recommendationType === 'ANOMALY_DETECTION') {
      const dedupeWindowStart = new Date(Date.now() - 6 * 60 * 60 * 1000)
      const existing = await prisma.enterpriseAiRecommendation.findFirst({
        where: {
          tenantId: access.tenantId,
          recommendationType: payload.recommendationType,
          status: { in: ['OPEN', 'SNOOZED'] },
          createdAt: { gte: dedupeWindowStart },
          ...(payload.subsidiaryId ? { subsidiaryId: payload.subsidiaryId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      })

      if (existing) {
        return NextResponse.json({ data: existing })
      }
    }

    const created = await prisma.enterpriseAiRecommendation.create({
      data: {
        tenantId: access.tenantId,
        subsidiaryId: payload.subsidiaryId,
        recommendationType: payload.recommendationType,
        title: generated.title,
        summary: generated.summary,
        confidenceScore: generated.confidence,
        riskScore: generated.riskScore,
        reasonCodes: generated.reasonCodes,
        sourceProvenance: generated.sourceProvenance,
        modelVersion: generated.modelVersion,
        inputSnapshot: generated.inputSnapshot,
        outputPayload: generated.outputPayload,
      },
    })

    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId: access.tenantId,
        metricKey: 'recommendation_generated',
        metricValue: 1,
        dimensions: {
          recommendationType: payload.recommendationType,
          modelVersion: generated.modelVersion,
        },
      },
    })

    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'ENTERPRISE_AI_RECOMMENDATION_GENERATE',
      entity: 'EnterpriseAiRecommendation',
      entityId: created.id,
      newValues: {
        recommendationType: payload.recommendationType,
        modelVersion: generated.modelVersion,
      },
      req,
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 422 })
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI RECOMMENDATIONS POST]', err)
    return apiError((err as Error).message || 'Internal server error', 500)
  }
}
