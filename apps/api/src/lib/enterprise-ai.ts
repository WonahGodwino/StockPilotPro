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
  const [salesBySubsidiary, expensesBySubsidiary, productsBySubsidiary, lowStockCount, salesByProduct, productCatalog] = await Promise.all([
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
  ])

  const now = new Date()
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
    productMetrics: productCatalog.map((product) => {
      const sales = salesByProduct.find((x) => x.productId === product.id)
      return {
        productId: product.id,
        productName: product.name,
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
