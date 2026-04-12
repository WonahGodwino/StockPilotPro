import { prisma } from '@/lib/prisma'
import type { JWTPayload } from '@/lib/jwt'
import { hasPlanFeature, isEnterprisePlan, getActiveSubscriptionForTenant } from '@/lib/subscription-enforcement'
import { isUnsafeAssistantPrompt, roleSupportsEnterpriseAi } from '@/lib/enterprise-ai-policy'

export const ENTERPRISE_UPGRADE_HINT = {
  requiredPackage: 'Enterprise',
  reason: 'Enterprise AI capability is restricted to Enterprise package tenants.',
}

export class EnterpriseAccessError extends Error {
  status: number
  metadata?: unknown

  constructor(message: string, status = 403, metadata?: unknown) {
    super(message)
    this.status = status
    this.metadata = metadata
  }
}

export type EnterpriseAccessContext = {
  tenantId: string
  userId: string
  planId: string
  planName: string
  features: unknown
}

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function pctDelta(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100
  return ((current - prior) / Math.abs(prior)) * 100
}

function weekdayLabel(date: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
}

function normalizeFeatureToken(token: string): string {
  return token.trim().toUpperCase().replace(/\s+/g, '_')
}

export async function requireEnterpriseAiAccess(
  user: JWTPayload,
  requiredFeatures: string[] = []
): Promise<EnterpriseAccessContext> {
  if (!user.tenantId) {
    throw new EnterpriseAccessError('No tenant context available for this user.', 400)
  }

  if (!roleSupportsEnterpriseAi(user.role)) {
    throw new EnterpriseAccessError('Forbidden: role does not allow Enterprise AI access.', 403, ENTERPRISE_UPGRADE_HINT)
  }

  const subscription = await getActiveSubscriptionForTenant(user.tenantId)
  if (!subscription) {
    throw new EnterpriseAccessError('No active subscription found for tenant.', 403, ENTERPRISE_UPGRADE_HINT)
  }

  if (!isEnterprisePlan(subscription.plan)) {
    throw new EnterpriseAccessError('Enterprise package required to access Enterprise AI endpoints.', 403, {
      ...ENTERPRISE_UPGRADE_HINT,
      currentPlan: subscription.plan.name,
    })
  }

  const missing = requiredFeatures
    .map((feature) => normalizeFeatureToken(feature))
    .filter((feature) => !hasPlanFeature(subscription.plan, feature))

  if (missing.length > 0) {
    throw new EnterpriseAccessError('Required Enterprise AI features are not enabled on current package.', 403, {
      ...ENTERPRISE_UPGRADE_HINT,
      currentPlan: subscription.plan.name,
      missingFeatures: missing,
    })
  }

  return {
    tenantId: user.tenantId,
    userId: user.userId,
    planId: subscription.planId,
    planName: subscription.plan.name,
    features: subscription.plan.features,
  }
}

export async function buildEnterpriseFeatureSnapshot(tenantId: string) {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  const [
    salesBySubsidiary,
    expensesBySubsidiary,
    productsBySubsidiary,
    lowStockCount,
    salesByProduct,
    productCatalog,
    recentSales,
    sales7,
    salesPrior7,
    sales30,
    salesPrior30,
    expenses7,
    expensesPrior7,
    expenses30,
    expensesPrior30,
  ] = await Promise.all([
    prisma.sale.groupBy({
      by: ['subsidiaryId'],
      where: { tenantId, archived: false },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.expense.groupBy({
      by: ['subsidiaryId'],
      where: { tenantId, archived: false },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.product.groupBy({
      by: ['subsidiaryId'],
      where: { tenantId, archived: false },
      _sum: { quantity: true },
      _count: { _all: true },
    }),
    prisma.product.count({
      where: {
        tenantId,
        archived: false,
        type: 'GOODS',
        quantity: { lte: prisma.product.fields.lowStockThreshold },
      },
    }).catch(() => 0),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          tenantId,
          archived: false,
        },
      },
      _sum: { quantity: true, subtotal: true },
      _count: { _all: true },
    }),
    prisma.product.findMany({
      where: { tenantId, archived: false },
      select: {
        id: true,
        name: true,
        subsidiaryId: true,
        type: true,
        quantity: true,
        lowStockThreshold: true,
        costPrice: true,
        sellingPrice: true,
      },
      take: 300,
    }),
    prisma.sale.findMany({
      where: { tenantId, archived: false, createdAt: { gte: thirtyDaysAgo } },
      select: {
        subsidiaryId: true,
        totalAmount: true,
        discount: true,
        createdAt: true,
      },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.sale.aggregate({
      where: { tenantId, archived: false, createdAt: { gte: sevenDaysAgo } },
      _sum: { totalAmount: true, discount: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { tenantId, archived: false, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      _sum: { totalAmount: true, discount: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { tenantId, archived: false, createdAt: { gte: thirtyDaysAgo } },
      _sum: { totalAmount: true, discount: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: { tenantId, archived: false, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      _sum: { totalAmount: true, discount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { tenantId, archived: false, date: { gte: sevenDaysAgo } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { tenantId, archived: false, date: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { tenantId, archived: false, date: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { tenantId, archived: false, date: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ])

  const seasonality = recentSales.reduce<Record<string, number>>((acc, sale) => {
    const label = weekdayLabel(sale.createdAt)
    acc[label] = (acc[label] || 0) + toNumber(sale.totalAmount)
    return acc
  }, {})

  const branchDiscountIntensity = recentSales.reduce<Record<string, { discount: number; revenue: number; ratio: number }>>((acc, sale) => {
    const branch = sale.subsidiaryId || 'unassigned'
    const revenue = toNumber(sale.totalAmount)
    const discount = toNumber(sale.discount)
    const current = acc[branch] || { discount: 0, revenue: 0, ratio: 0 }
    const next = {
      discount: current.discount + discount,
      revenue: current.revenue + revenue,
      ratio: 0,
    }
    next.ratio = next.revenue > 0 ? next.discount / next.revenue : 0
    acc[branch] = next
    return acc
  }, {})

  const categoryMarginBands = productCatalog.reduce<Record<string, { low: number; medium: number; high: number; products: number }>>((acc, product) => {
    const category = product.type || 'uncategorized'
    const row = acc[category] || { low: 0, medium: 0, high: 0, products: 0 }
    const selling = toNumber(product.sellingPrice)
    const cost = toNumber(product.costPrice)
    const marginPct = selling > 0 ? ((selling - cost) / selling) * 100 : 0
    if (marginPct < 15) row.low += 1
    else if (marginPct < 30) row.medium += 1
    else row.high += 1
    row.products += 1
    acc[category] = row
    return acc
  }, {})

  const horizon = {
    last7: {
      revenue: toNumber(sales7._sum.totalAmount),
      expense: toNumber(expenses7._sum.amount),
      net: toNumber(sales7._sum.totalAmount) - toNumber(expenses7._sum.amount),
      txCount: sales7._count._all,
      expenseCount: expenses7._count._all,
      discountIntensity: toNumber(sales7._sum.totalAmount) > 0 ? toNumber(sales7._sum.discount) / toNumber(sales7._sum.totalAmount) : 0,
    },
    prior7: {
      revenue: toNumber(salesPrior7._sum.totalAmount),
      expense: toNumber(expensesPrior7._sum.amount),
      net: toNumber(salesPrior7._sum.totalAmount) - toNumber(expensesPrior7._sum.amount),
      txCount: salesPrior7._count._all,
      expenseCount: expensesPrior7._count._all,
      discountIntensity: toNumber(salesPrior7._sum.totalAmount) > 0 ? toNumber(salesPrior7._sum.discount) / toNumber(salesPrior7._sum.totalAmount) : 0,
    },
    last30: {
      revenue: toNumber(sales30._sum.totalAmount),
      expense: toNumber(expenses30._sum.amount),
      net: toNumber(sales30._sum.totalAmount) - toNumber(expenses30._sum.amount),
      txCount: sales30._count._all,
      expenseCount: expenses30._count._all,
      discountIntensity: toNumber(sales30._sum.totalAmount) > 0 ? toNumber(sales30._sum.discount) / toNumber(sales30._sum.totalAmount) : 0,
    },
    prior30: {
      revenue: toNumber(salesPrior30._sum.totalAmount),
      expense: toNumber(expensesPrior30._sum.amount),
      net: toNumber(salesPrior30._sum.totalAmount) - toNumber(expensesPrior30._sum.amount),
      txCount: salesPrior30._count._all,
      expenseCount: expensesPrior30._count._all,
      discountIntensity: toNumber(salesPrior30._sum.totalAmount) > 0 ? toNumber(salesPrior30._sum.discount) / toNumber(salesPrior30._sum.totalAmount) : 0,
    },
  }

  const horizonDeltas = {
    h7: {
      revenuePct: pctDelta(horizon.last7.revenue, horizon.prior7.revenue),
      expensePct: pctDelta(horizon.last7.expense, horizon.prior7.expense),
      netPct: pctDelta(horizon.last7.net, horizon.prior7.net),
    },
    h30: {
      revenuePct: pctDelta(horizon.last30.revenue, horizon.prior30.revenue),
      expensePct: pctDelta(horizon.last30.expense, horizon.prior30.expense),
      netPct: pctDelta(horizon.last30.net, horizon.prior30.net),
    },
  }

  const snapshot = {
    generatedAt: now.toISOString(),
    branchMetrics: salesBySubsidiary.map((row) => {
      const expense = expensesBySubsidiary.find((x) => x.subsidiaryId === row.subsidiaryId)
      const stock = productsBySubsidiary.find((x) => x.subsidiaryId === row.subsidiaryId)
      return {
        subsidiaryId: row.subsidiaryId,
        salesCount: row._count._all,
        revenue: Number(row._sum.totalAmount || 0),
        expense: Number(expense?._sum.amount || 0),
        expenseCount: expense?._count._all || 0,
        stockUnits: Number(stock?._sum.quantity || 0),
        productsCount: stock?._count._all || 0,
      }
    }),
    lowStockCount,
    lowStockExposureProducts: productCatalog
      .filter((product) => toNumber(product.quantity) <= toNumber(product.lowStockThreshold))
      .map((product) => ({
        productId: product.id,
        productName: product.name,
        category: product.type,
        stockOnHand: toNumber(product.quantity),
        lowStockThreshold: toNumber(product.lowStockThreshold),
      })),
    horizon,
    horizonDeltas,
    weekdaySeasonalityRevenue: seasonality,
    branchDiscountIntensity,
    categoryMarginBands,
    productMetrics: productCatalog.map((product) => {
      const sales = salesByProduct.find((x) => x.productId === product.id)
      return {
        productId: product.id,
        productName: product.name,
        category: product.type,
        subsidiaryId: product.subsidiaryId,
        productType: product.type,
        soldUnits: Number(sales?._sum.quantity || 0),
        salesRevenue: Number(sales?._sum.subtotal || 0),
        salesCount: sales?._count._all || 0,
        stockOnHand: Number(product.quantity),
        lowStockThreshold: Number(product.lowStockThreshold),
        costPrice: Number(product.costPrice),
        sellingPrice: Number(product.sellingPrice),
      }
    }),
  }

  const created = await prisma.enterpriseAiFeatureSnapshot.create({
    data: {
      tenantId,
      snapshotVersion: 'v1',
      freshnessScore: 100,
      generatedAt: now,
      featureSnapshot: snapshot,
      sourceCoverage: {
        tenant: ['sales', 'expenses', 'products'],
        public: ['seasonality-placeholder'],
        platform: ['benchmark-placeholder'],
      },
    },
  })

  return created
}

export async function getFreshFeatureSnapshot(tenantId: string, maxAgeMinutes = 30) {
  const latest = await prisma.enterpriseAiFeatureSnapshot.findFirst({
    where: { tenantId },
    orderBy: { generatedAt: 'desc' },
  })

  if (!latest) return buildEnterpriseFeatureSnapshot(tenantId)

  const maxAgeMs = maxAgeMinutes * 60 * 1000
  if (Date.now() - latest.generatedAt.getTime() > maxAgeMs) {
    return buildEnterpriseFeatureSnapshot(tenantId)
  }

  return latest
}
