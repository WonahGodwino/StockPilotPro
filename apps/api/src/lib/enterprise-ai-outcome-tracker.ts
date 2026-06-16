import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { round2 } from './enterprise-ai-statistics'

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function calculateSuccessScore(predicted: number, actual: number): number {
  if (predicted === 0) return 50
  const ratio = actual / predicted
  if (ratio >= 1.2) return 90
  if (ratio >= 1.0) return 75
  if (ratio >= 0.8) return 60
  if (ratio >= 0.5) return 40
  return 20
}

function getRecommendationPrediction(row: {
  confidenceScore: Prisma.Decimal | number | null
  outputPayload: unknown
}): number {
  const payload = asRecord(row.outputPayload)
  const ranking = asRecord(payload.ranking)
  const explicit = toNumber(ranking.priorityScore)
  if (explicit > 0) return explicit
  return round2(toNumber(row.confidenceScore) * 100)
}

function extractProductId(row: { inputSnapshot: unknown; outputPayload: unknown }): string | null {
  const input = asRecord(row.inputSnapshot)
  const output = asRecord(row.outputPayload)
  const direct = typeof input.productId === 'string' ? input.productId : typeof output.productId === 'string' ? output.productId : null
  if (direct) return direct

  const priceAdjustment = asRecord(output.priceAdjustment)
  if (typeof priceAdjustment.productId === 'string') return priceAdjustment.productId
  return null
}

async function measureReorderImpact(recommendation: {
  id: string
  tenantId: string
  createdAt: Date
  inputSnapshot: unknown
  outputPayload: unknown
}): Promise<number> {
  const productId = extractProductId(recommendation)
  if (!productId) return 50

  const beforeDate = recommendation.createdAt
  const lookbackStart = new Date(beforeDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  const afterDate = new Date(beforeDate.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [beforeSales, afterSales] = await Promise.all([
    prisma.saleItem.aggregate({
      where: {
        productId,
        sale: {
          tenantId: recommendation.tenantId,
          archived: false,
          createdAt: { gte: lookbackStart, lt: beforeDate },
        },
      },
      _sum: { quantity: true },
    }),
    prisma.saleItem.aggregate({
      where: {
        productId,
        sale: {
          tenantId: recommendation.tenantId,
          archived: false,
          createdAt: { gte: beforeDate, lt: afterDate },
        },
      },
      _sum: { quantity: true },
    }),
  ])

  const beforeQty = toNumber(beforeSales._sum.quantity)
  const afterQty = toNumber(afterSales._sum.quantity)
  const improvement = ((afterQty - beforeQty) / Math.max(1, beforeQty)) * 100
  return round2(clamp(improvement, -100, 200))
}

async function calculateProductMargin(tenantId: string, productId: string, startDate: Date, endDate: Date): Promise<number> {
  const sales = await prisma.saleItem.findMany({
    where: {
      productId,
      sale: {
        tenantId,
        archived: false,
        createdAt: { gte: startDate, lt: endDate },
      },
    },
    select: {
      quantity: true,
      subtotal: true,
      costPrice: true,
    },
  })

  if (sales.length === 0) return 0
  const revenue = sales.reduce((sum, row) => sum + toNumber(row.subtotal), 0)
  const cost = sales.reduce((sum, row) => sum + toNumber(row.quantity) * toNumber(row.costPrice), 0)
  return revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0
}

async function measurePricingImpact(recommendation: {
  tenantId: string
  createdAt: Date
  inputSnapshot: unknown
  outputPayload: unknown
}): Promise<number> {
  const productId = extractProductId(recommendation)
  if (!productId) return 50
  const beforeDate = recommendation.createdAt
  const lookbackStart = new Date(beforeDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  const afterDate = new Date(beforeDate.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [beforeMargin, afterMargin] = await Promise.all([
    calculateProductMargin(recommendation.tenantId, productId, lookbackStart, beforeDate),
    calculateProductMargin(recommendation.tenantId, productId, beforeDate, afterDate),
  ])

  return round2(afterMargin - beforeMargin)
}

async function measureExpenseImpact(recommendation: {
  tenantId: string
  createdAt: Date
}): Promise<number> {
  const beforeDate = recommendation.createdAt
  const lookbackStart = new Date(beforeDate.getTime() - 30 * 24 * 60 * 60 * 1000)
  const afterDate = new Date(beforeDate.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [beforeExpenses, afterExpenses] = await Promise.all([
    prisma.expense.aggregate({
      where: { tenantId: recommendation.tenantId, archived: false, date: { gte: lookbackStart, lt: beforeDate } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { tenantId: recommendation.tenantId, archived: false, date: { gte: beforeDate, lt: afterDate } },
      _sum: { amount: true },
    }),
  ])

  const beforeTotal = toNumber(beforeExpenses._sum.amount)
  const afterTotal = toNumber(afterExpenses._sum.amount)
  const reduction = ((beforeTotal - afterTotal) / Math.max(1, beforeTotal)) * 100
  return round2(clamp(reduction, -50, 100))
}

async function measureGeneralImpact(recommendation: {
  id: string
  tenantId: string
}): Promise<number> {
  const decision = await prisma.enterpriseAiRecommendationDecision.findFirst({
    where: { recommendationId: recommendation.id, tenantId: recommendation.tenantId },
    orderBy: { createdAt: 'desc' },
  })

  if (decision?.action === 'accept') return 75
  if (decision?.action === 'resolve') return 85
  if (decision?.action === 'reject') return 20
  if (decision?.action === 'not_relevant') return 10
  return 50
}

export async function captureRecommendationOutcome(recommendationId: string): Promise<boolean> {
  const recommendation = await prisma.enterpriseAiRecommendation.findUnique({
    where: { id: recommendationId },
    select: {
      id: true,
      tenantId: true,
      recommendationType: true,
      confidenceScore: true,
      createdAt: true,
      actedAt: true,
      inputSnapshot: true,
      outputPayload: true,
    },
  })
  if (!recommendation) return false

  const existing = await prisma.recommendationOutcome.findFirst({ where: { recommendationId } })
  if (existing) return false

  let actualImpact = 50
  if (recommendation.recommendationType === 'REORDER_ADVISOR') {
    actualImpact = await measureReorderImpact(recommendation)
  } else if (recommendation.recommendationType === 'PRICING_MARGIN_ADVISOR') {
    actualImpact = await measurePricingImpact(recommendation)
  } else if (recommendation.recommendationType === 'EXPENSE_RISK_ALERT') {
    actualImpact = await measureExpenseImpact(recommendation)
  } else {
    actualImpact = await measureGeneralImpact(recommendation)
  }

  const predictedImpact = getRecommendationPrediction(recommendation)
  const deviation = round2(actualImpact - predictedImpact)
  const successScore = calculateSuccessScore(predictedImpact, actualImpact)

  await prisma.recommendationOutcome.create({
    data: {
      recommendationId,
      tenantId: recommendation.tenantId,
      recommendationType: recommendation.recommendationType,
      predictedImpact,
      actualImpact,
      deviation,
      successScore,
      appliedAt: recommendation.actedAt || recommendation.createdAt,
      measuredAt: new Date(),
    },
  })

  await prisma.enterpriseAiMetric.create({
    data: {
      tenantId: recommendation.tenantId,
      metricKey: 'recommendation_outcome_captured',
      metricValue: 1,
      dimensions: {
        recommendationType: recommendation.recommendationType,
        recommendationId,
        successScore,
      },
    },
  }).catch(() => {})

  return true
}

export async function capturePendingRecommendationOutcomes(args: {
  tenantId?: string
  olderThanDays?: number
  limit?: number
} = {}): Promise<{ scanned: number; captured: number }> {
  const olderThanDays = Math.max(1, args.olderThanDays || 30)
  const limit = Math.min(100, Math.max(1, args.limit || 25))
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)

  const rows = await prisma.enterpriseAiRecommendation.findMany({
    where: {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      status: { in: ['ACCEPTED', 'RESOLVED', 'REJECTED', 'NOT_RELEVANT'] },
      actedAt: { not: null, lte: cutoff },
    },
    orderBy: { actedAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  let captured = 0
  for (const row of rows) {
    const created = await captureRecommendationOutcome(row.id)
    if (created) captured += 1
  }

  return { scanned: rows.length, captured }
}

export async function trackWorkflowOutcome(args: {
  executionId: string
  actualImpact: number
}): Promise<boolean> {
  const execution = await prisma.autonomousExecution.findUnique({
    where: { id: args.executionId },
    select: {
      id: true,
      tenantId: true,
      ruleId: true,
      result: true,
    },
  })
  if (!execution) return false

  await prisma.autonomousExecution.update({
    where: { id: execution.id },
    data: {
      result: toJsonValue({
        ...asRecord(execution.result),
        actualImpact: round2(args.actualImpact),
        measuredAt: new Date().toISOString(),
      }),
      status: 'executed',
      executedAt: new Date(),
    },
  })

  await prisma.autonomousRule.update({
    where: { id: execution.ruleId },
    data: {
      executionCount: { increment: 1 },
      successCount: args.actualImpact > 0 ? { increment: 1 } : undefined,
    },
  }).catch(() => {})

  return true
}