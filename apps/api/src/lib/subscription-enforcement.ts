import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type ActiveSubscription = Prisma.SubscriptionGetPayload<{
  include: { plan: true }
}>

function normalizeFeatureToken(token: string): string {
  return token.trim().toUpperCase().replace(/\s+/g, '_')
}

function parseNumericFeature(features: unknown, keys: string[]): number | null {
  if (features && typeof features === 'object' && !Array.isArray(features)) {
    const obj = features as Record<string, unknown>
    for (const key of keys) {
      const value = obj[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
      if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed >= 0) return parsed
      }
    }
  }

  if (Array.isArray(features)) {
    const normalizedKeys = keys.map((k) => normalizeFeatureToken(k))
    for (const raw of features) {
      if (typeof raw !== 'string') continue
      const token = normalizeFeatureToken(raw)
      for (const key of normalizedKeys) {
        const match = token.match(new RegExp(`^${key}[:=](\\d+)$`))
        if (match) return Number(match[1])
      }
    }
  }

  return null
}

function parsePlanFeatures(features: unknown): Set<string> {
  const tokens = new Set<string>()

  if (Array.isArray(features)) {
    for (const value of features) {
      if (typeof value === 'string' && value.trim()) {
        tokens.add(normalizeFeatureToken(value))
      }
    }
    return tokens
  }

  if (features && typeof features === 'object') {
    for (const [key, value] of Object.entries(features as Record<string, unknown>)) {
      if (value === true) tokens.add(normalizeFeatureToken(key))
    }
  }

  return tokens
}

export function hasPlanFeature(plan: { name: string; features: unknown }, feature: string): boolean {
  const wanted = normalizeFeatureToken(feature)
  const featureSet = parsePlanFeatures(plan.features)
  return featureSet.has(wanted)
}

export function isEnterprisePlan(plan: { name: string; features: unknown }): boolean {
  if (hasPlanFeature(plan, 'ENTERPRISE_AI_ENABLED')) return true
  if (hasPlanFeature(plan, 'UNLIMITED_BRANCHES')) return true
  if (hasPlanFeature(plan, 'ENTERPRISE_PACKAGE')) return true
  return /\benterprise\b/i.test(plan.name)
}

export function isStarterPlan(plan: { name: string; features: unknown }): boolean {
  if (hasPlanFeature(plan, 'STARTER_PACKAGE')) return true
  return /\bstarter\b/i.test(plan.name)
}

export function blocksSubsidiaryCreation(plan: { name: string; features: unknown; maxSubsidiaries: number }): boolean {
  if (plan.maxSubsidiaries <= 0) return true
  if (hasPlanFeature(plan, 'NO_BRANCHES')) return true
  return isStarterPlan(plan)
}

export function getRoleSeatLimit(
  plan: { name: string; features: unknown },
  role: 'BUSINESS_ADMIN' | 'SALESPERSON'
): number | null {
  if (role === 'BUSINESS_ADMIN') {
    if (hasPlanFeature(plan, 'UNLIMITED_BUSINESS_ADMINS')) return null
    const configured = parseNumericFeature(plan.features, ['maxBusinessAdmins', 'MAX_BUSINESS_ADMINS'])
    if (configured !== null) return configured
    return isStarterPlan(plan) ? 1 : null
  }

  if (hasPlanFeature(plan, 'UNLIMITED_SALESPERSONS')) return null
  const configured = parseNumericFeature(plan.features, ['maxSalespersons', 'MAX_SALESPERSONS'])
  if (configured !== null) return configured
  return isStarterPlan(plan) ? 1 : null
}

export async function getActiveSubscriptionForTenant(tenantId: string, now = new Date()): Promise<ActiveSubscription | null> {
  await prisma.subscription.updateMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      expiryDate: { lt: now },
    },
    data: { status: 'EXPIRED' },
  })

  return prisma.subscription.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      expiryDate: { gte: now },
    },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function assertTenantHasPackageFeature(tenantId: string, feature: string): Promise<ActiveSubscription> {
  const activeSubscription = await getActiveSubscriptionForTenant(tenantId)
  if (!activeSubscription) {
    throw new Error('Subscription expired or inactive. Contact your administrator.')
  }
  if (!hasPlanFeature(activeSubscription.plan, feature)) {
    throw new Error(`Your package does not include ${feature}. Upgrade required.`)
  }
  return activeSubscription
}
