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
import { generateEnterpriseAssistantResponse } from '@/lib/enterprise-ai-assistant'

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
  prompt: z.string().max(2000).optional(),
  conversationId: z.string().max(120).optional(),
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

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0
  const m = mean(values)
  const variance = values.reduce((sum, value) => sum + ((value - m) ** 2), 0) / values.length
  return Math.sqrt(variance)
}

function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildDailyDemandSeries(args: {
  since: Date
  windowDays: number
  rows: Array<{ quantity: unknown; createdAt: Date }>
}): number[] {
  const bucket = new Map<string, number>()
  for (const row of args.rows) {
    const key = dayKeyUtc(row.createdAt)
    bucket.set(key, (bucket.get(key) || 0) + toNumber(row.quantity))
  }

  const series: number[] = []
  for (let idx = 0; idx < args.windowDays; idx += 1) {
    const day = new Date(args.since.getTime() + idx * 24 * 60 * 60 * 1000)
    const key = dayKeyUtc(day)
    series.push(bucket.get(key) || 0)
  }
  return series
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
}

function signalExpensePressureScore(signals: Array<{ signalKey: string; signalValue: unknown; tags: unknown }>): number {
  let score = 0
  for (const signal of signals) {
    const text = [
      signal.signalKey,
      ...toStringArray(signal.tags),
      JSON.stringify(toRecord(signal.signalValue)),
    ].join(' ').toLowerCase()

    if (/inflation|fuel|fx|currency|supply|freight|import|shortage/.test(text)) score += 1
    if (/tax|regulatory|duty|compliance/.test(text)) score += 0.6
  }
  return clamp(score / 6, 0, 1)
}

function outcomeMultiplierFromStatuses(statuses: Array<{ status: string }>): number {
  if (statuses.length === 0) return 1
  const positive = statuses.filter((x) => x.status === 'ACCEPTED' || x.status === 'RESOLVED').length
  const negative = statuses.filter((x) => x.status === 'REJECTED' || x.status === 'NOT_RELEVANT').length
  const score = (positive - negative) / statuses.length
  return clamp(1 + score * 0.2, 0.8, 1.2)
}

function computePriorityScore(confidence: number, riskScore: number, outcomeMultiplier: number): number {
  const confidenceN = clamp(confidence, 0, 1)
  const riskN = clamp(riskScore, 0, 1)
  const base = (confidenceN * 0.6 + (1 - riskN) * 0.4) * 100
  return Math.round(clamp(base * outcomeMultiplier, 1, 100))
}

async function createRecommendationFromType(args: {
  tenantId: string
  userId: string
  recommendationType: z.infer<typeof recommendationTypeSchema>
  subsidiaryId?: string
  productId?: string
  prompt?: string
  conversationId?: string
  horizonDays?: number
  snapshot: Awaited<ReturnType<typeof getFreshFeatureSnapshot>>
}) {
  const { tenantId, recommendationType, subsidiaryId, productId, prompt, conversationId, snapshot } = args
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
      select: {
        quantity: true,
        sale: { select: { createdAt: true } },
      },
    })

    const soldUnits30 = soldRows.reduce((sum, row) => sum + toNumber(row.quantity), 0)
    const dailySeries = buildDailyDemandSeries({
      since,
      windowDays: 30,
      rows: soldRows.map((row) => ({ quantity: row.quantity, createdAt: row.sale.createdAt })),
    })
    const avgDailyDemand = mean(dailySeries)
    const dailyStdDev = stdDev(dailySeries)
    const demandCv = avgDailyDemand > 0 ? dailyStdDev / avgDailyDemand : 1
    const stabilityFactor = clamp(1 - Math.min(1, demandCv / 1.5), 0.35, 1)
    const reorderPoint = Math.max(1, Math.ceil(avgDailyDemand * 7))
    const suggestedQty = Math.max(0, Math.ceil(avgDailyDemand * 14 - toNumber(product.quantity)))
    const confidence = clamp(confidenceFromVolume(soldUnits30) * (0.75 + stabilityFactor * 0.25), 0.3, 0.95)
    const expectedDemandUnits = avgDailyDemand * horizonDays
    const intervalHalfWidth80 = 1.2816 * dailyStdDev * Math.sqrt(Math.max(1, horizonDays))
    const p10DemandUnits = Math.max(0, expectedDemandUnits - intervalHalfWidth80)
    const p90DemandUnits = Math.max(0, expectedDemandUnits + intervalHalfWidth80)

    return {
      title: recommendationType === 'DEMAND_FORECAST'
        ? `Demand forecast for ${product.name}`
        : `Reorder recommendation for ${product.name}`,
      summary: recommendationType === 'DEMAND_FORECAST'
        ? `Expected demand is ${avgDailyDemand.toFixed(2)} units/day over the next ${horizonDays} days (80% interval ${p10DemandUnits.toFixed(1)} to ${p90DemandUnits.toFixed(1)} units).`
        : suggestedQty > 0
        ? `Reorder ${suggestedQty} units to avoid stockout risk.`
        : `Current stock is healthy relative to observed demand.`,
      confidence,
      riskScore: suggestedQty > 0 ? Math.min(0.95, 0.4 + suggestedQty / 200) : 0.2,
      reasonCodes: ['SALES_VELOCITY', 'CURRENT_STOCK', 'LOW_STOCK_THRESHOLD', 'DEMAND_VARIABILITY'],
      sourceProvenance: ['tenant:sales', 'tenant:inventory'],
      outputPayload: {
        productId: product.id,
        productName: product.name,
        forecastHorizonDays: horizonDays,
        soldUnits30,
        avgDailyDemand,
        demandStdDevDaily: Number(dailyStdDev.toFixed(4)),
        demandCv: Number(demandCv.toFixed(4)),
        expectedDemandUnits: Number(expectedDemandUnits.toFixed(2)),
        forecastInterval80: {
          p10: Number(p10DemandUnits.toFixed(2)),
          p90: Number(p90DemandUnits.toFixed(2)),
        },
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

    const [salesRecent, expenseRecent, expensePrior, recentSignals] = await Promise.all([
      prisma.sale.aggregate({ where: { tenantId, archived: false, createdAt: { gte: thirtyDaysAgo } }, _sum: { totalAmount: true } }),
      prisma.expense.aggregate({ where: { tenantId, archived: false, date: { gte: thirtyDaysAgo } }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { tenantId, archived: false, date: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _sum: { amount: true } }),
      prisma.enterpriseAiSignal.findMany({
        where: {
          OR: [
            { signalClass: 'PUBLIC' },
            { signalClass: 'PLATFORM' },
            { signalClass: 'TENANT', tenantId },
          ],
          effectiveDate: { gte: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { effectiveDate: 'desc' },
        take: 50,
        select: { signalKey: true, signalValue: true, tags: true, source: true },
      }),
    ])

    const inflow = toNumber(salesRecent._sum.totalAmount)
    const outflow = toNumber(expenseRecent._sum.amount)
    const priorOutflow = toNumber(expensePrior._sum.amount)
    const net = inflow - outflow
    const spikePct = priorOutflow > 0 ? ((outflow - priorOutflow) / priorOutflow) * 100 : 0
    const pressure = signalExpensePressureScore(recentSignals)

    const adaptiveSpikeThreshold = 14 - pressure * 6
    const expenseRiskTriggered = spikePct > adaptiveSpikeThreshold || net < 0
    const riskScore = clamp(
      (expenseRiskTriggered ? 0.45 : 0.18) +
      (pressure * 0.35) +
      (net < 0 ? 0.18 : 0),
      0.12,
      0.98,
    )
    const confidence = clamp(0.56 + Math.min(1, (inflow + outflow) / 300000) * 0.28 + pressure * 0.08, 0.42, 0.94)

    return {
      title: recommendationType === 'CASHFLOW_FORECAST' ? 'Cash-flow forecast outlook' : 'Expense risk alert summary',
      summary: recommendationType === 'CASHFLOW_FORECAST'
        ? `Projected net position for next ${horizonDays} days is ${net.toFixed(2)} based on current run-rate with external pressure score ${pressure.toFixed(2)}.`
        : spikePct > adaptiveSpikeThreshold
        ? `Expense run-rate increased by ${spikePct.toFixed(1)}% versus prior period (adaptive threshold ${adaptiveSpikeThreshold.toFixed(1)}%).`
        : 'No significant expense spike detected in the current period.',
      confidence,
      riskScore,
      reasonCodes: recommendationType === 'CASHFLOW_FORECAST'
        ? ['INFLOW_OUTFLOW_TREND', 'NET_POSITION', 'EXTERNAL_PRESSURE_ADJUSTMENT']
        : ['EXPENSE_SPIKE_ANALYSIS', 'CATEGORY_VARIANCE', 'TENANT_ADAPTIVE_THRESHOLD'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', ...(recentSignals.length ? ['public/platform:signals'] : [])],
      outputPayload: {
        horizonDays,
        inflow,
        outflow,
        projectedNetPosition: net,
        expenseSpikePercent: spikePct,
        adaptiveSpikeThreshold,
        externalPressureScore: pressure,
        externalSignalSources: [...new Set(recentSignals.map((x) => x.source).filter(Boolean))].slice(0, 6),
        severity: riskScore >= 0.75 ? 'HIGH' : riskScore >= 0.45 ? 'MEDIUM' : 'LOW',
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
      title: 'Branch performance insights',
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
          conversationId: conversationId || null,
          response: 'Request rejected due to unsafe content. Ask for inventory, sales, branch, pricing, or expense guidance.',
        },
        modelVersion,
        inputSnapshot: snapshotInput,
      }
    }

    const assistant = await generateEnterpriseAssistantResponse({
      tenantId,
      prompt: safePrompt,
      conversationId,
    })

    const confidence = clamp(
      (assistant.provider === 'external-llm' ? 0.72 : 0.62) * (0.7 + assistant.reliability.groundingQualityScore * 0.45),
      0.35,
      0.95,
    )
    const riskScore = clamp(
      0.12 + (1 - assistant.reliability.groundingQualityScore) * 0.55 + (assistant.reliability.usedFallback ? 0.14 : 0),
      0.08,
      0.92,
    )

    const topBranches = assistant.grounding.branchComparisons.slice(0, 5)
    const topProducts = assistant.grounding.productComparisons.slice(0, 5)

    return {
      title: 'Enterprise assistant response',
      summary: `Assistant generated a grounded response (${assistant.provider}) with comparative branch and product insights.`,
      confidence,
      riskScore,
      reasonCodes: ['TENANT_SCOPED_ANALYTICS_QUERY', 'PERIOD_COMPARISON', 'BRANCH_PRODUCT_ANALYSIS', 'ADAPTIVE_CONFIDENCE_CALIBRATION', 'GROUNDING_QUALITY_SCORING'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', 'tenant:products', 'tenant:assistant-history'],
      outputPayload: {
        prompt: safePrompt,
        conversationId: conversationId || null,
        provider: assistant.provider,
        currencyCode: assistant.grounding.tenantInfo.baseCurrency,
        incomeBreakdown: assistant.grounding.incomeBreakdown,
        reliability: assistant.reliability,
        periodLabel: assistant.grounding.periodLabel,
        response: assistant.response,
        brief: assistant.brief,
        comparativeOverview: {
          current: assistant.grounding.current,
          prior: assistant.grounding.prior,
          deltas: assistant.grounding.deltas,
        },
        topBranches,
        topProducts,
        followUpContextTurns: assistant.grounding.history.length,
      },
      modelVersion: assistant.modelVersion,
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
    const sort = searchParams.get('sort')
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
      take: sort === 'priority' ? Math.max(limit, 150) : limit,
    })

    const sortedRows = sort === 'priority'
      ? [...rows]
        .sort((a, b) => {
          const pa = Number(((a.outputPayload as { ranking?: { priorityScore?: number } })?.ranking?.priorityScore) || 0)
          const pb = Number(((b.outputPayload as { ranking?: { priorityScore?: number } })?.ranking?.priorityScore) || 0)
          return pb - pa
        })
        .slice(0, limit)
      : rows

    return NextResponse.json({ data: sortedRows })
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

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const historicalStatuses = await prisma.enterpriseAiRecommendation.findMany({
      where: {
        tenantId: access.tenantId,
        recommendationType: payload.recommendationType,
        createdAt: { gte: ninetyDaysAgo },
      },
      select: { status: true },
      take: 400,
    })
    const outcomeMultiplier = outcomeMultiplierFromStatuses(historicalStatuses)

    const generated = await createRecommendationFromType({
      tenantId: access.tenantId,
      userId: access.userId,
      recommendationType: payload.recommendationType,
      subsidiaryId: payload.subsidiaryId,
      productId: payload.productId,
      prompt: payload.prompt,
      conversationId: payload.conversationId,
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

    const priorityScore = computePriorityScore(generated.confidence, generated.riskScore, outcomeMultiplier)
    const mergedPayload = {
      ...toRecord(generated.outputPayload),
      ranking: {
        priorityScore,
        outcomeMultiplier,
        historicalSampleSize: historicalStatuses.length,
      },
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
        outputPayload: mergedPayload,
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

    if (payload.recommendationType === 'DEMAND_FORECAST' || payload.recommendationType === 'REORDER_ADVISOR') {
      const forecastPayload = created.outputPayload as {
        expectedDemandUnits?: number
        demandCv?: number
        forecastHorizonDays?: number
      } | null

      await prisma.enterpriseAiMetric.create({
        data: {
          tenantId: access.tenantId,
          metricKey: 'forecast_precision_profile',
          metricValue: Number(created.confidenceScore || 0),
          dimensions: {
            recommendationType: payload.recommendationType,
            horizonDays: forecastPayload?.forecastHorizonDays || payload.horizonDays || 30,
            expectedDemandUnits: Number(forecastPayload?.expectedDemandUnits || 0),
            demandCv: Number(forecastPayload?.demandCv || 0),
            modelVersion: created.modelVersion,
          },
        },
      })
    }

    if (payload.recommendationType === 'NL_ASSISTANT') {
      const assistantPayload = created.outputPayload as { provider?: string } | null
      await prisma.enterpriseAiMetric.create({
        data: {
          tenantId: access.tenantId,
          metricKey: 'assistant_response_generated',
          metricValue: 1,
          dimensions: {
            provider: assistantPayload?.provider || 'unknown',
            outputSchemaVersion: 'brief-v1',
            modelVersion: created.modelVersion,
          },
        },
      })
    }

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
