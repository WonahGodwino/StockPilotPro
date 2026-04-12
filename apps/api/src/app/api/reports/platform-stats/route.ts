import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

function toNumber(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

async function getTransactionToBaseRate(baseTenantId: string | null | undefined, baseCurrency: string, transactionCurrency: string): Promise<number> {
  if (transactionCurrency === baseCurrency) return 1
  if (!baseTenantId) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: { tenantId: baseTenantId, fromCurrency: baseCurrency, toCurrency: transactionCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (direct?.rate) return Number(direct.rate)

  const inverse = await prisma.currencyRate.findFirst({
    where: { tenantId: baseTenantId, fromCurrency: transactionCurrency, toCurrency: baseCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (inverse?.rate) return 1 / Number(inverse.rate)

  return 1
}

function toBaseExpenseAmount(amountRaw: unknown, fxRateRaw: unknown, currency: string, baseCurrency: string): number {
  const amount = toNumber(amountRaw)
  if (!Number.isFinite(amount)) return 0
  if (currency === baseCurrency) return amount

  const fxRate = Number(fxRateRaw)
  if (!Number.isFinite(fxRate) || fxRate <= 0) return amount
  return amount / fxRate
}

function getDateRange(period: string): { startDate: Date; endDate: Date } {
  const endDate = new Date()
  const startDate = new Date()

  switch (period) {
    case 'daily':
      startDate.setDate(startDate.getDate() - 1)
      break
    case 'weekly':
      startDate.setDate(startDate.getDate() - 7)
      break
    case 'monthly':
      startDate.setMonth(startDate.getMonth() - 1)
      break
    case 'quarterly':
      startDate.setMonth(startDate.getMonth() - 3)
      break
    case 'yearly':
      startDate.setFullYear(startDate.getFullYear() - 1)
      break
    default:
      startDate.setMonth(startDate.getMonth() - 1) // default to monthly
  }

  return { startDate, endDate }
}

function buildIntervalRanges(period: string, startDate: Date, endDate: Date) {
  let intervals = 30
  const daysDiff = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  )

  if (period === 'yearly') intervals = 12
  else if (period === 'quarterly') intervals = Math.min(13, Math.ceil(daysDiff / 7))
  else if (period === 'weekly') intervals = 7
  else intervals = Math.min(30, daysDiff)

  return Array.from({ length: intervals }, (_, i) => {
    const date = new Date(startDate)
    if (period === 'yearly') {
      date.setMonth(date.getMonth() + i)
    } else if (period === 'quarterly') {
      date.setDate(date.getDate() + Math.floor(daysDiff / intervals) * i)
    } else {
      date.setDate(date.getDate() + i)
    }

    const nextIntervalDate = new Date(date)
    if (period === 'yearly') {
      nextIntervalDate.setMonth(nextIntervalDate.getMonth() + 1)
    } else if (period === 'quarterly') {
      nextIntervalDate.setDate(nextIntervalDate.getDate() + Math.floor(daysDiff / intervals))
    } else {
      nextIntervalDate.setDate(nextIntervalDate.getDate() + 1)
    }

    return {
      date: date.toISOString().split('T')[0],
      start: date,
      end: nextIntervalDate,
    }
  })
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)

    // Only SUPER_ADMIN can access platform stats
    if (!isSuperAdmin(user)) {
      return apiError('Forbidden: Only SUPER_ADMIN can access platform statistics', 403)
    }

    const period = req.nextUrl.searchParams.get('period') || 'monthly'
    const { startDate, endDate } = getDateRange(period)

    const platformTenant = user.tenantId
      ? await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { baseCurrency: true } })
      : null
    const baseCurrency = platformTenant?.baseCurrency || 'USD'
    const fxTenantId = user.tenantId || null

      // Get total companies (tenants) - exclude the platform owner's own company
      const totalCompanies = await prisma.tenant.count({
        where: { 
          archived: false,
          id: { not: user.tenantId ?? '' }, // Exclude platform owner's company
        },
      })

    // Get total subsidiaries across all companies
    const totalSubsidiaries = await prisma.subsidiary.count({
      where: { 
        archived: false,
        NOT: {
          tenantId: user.tenantId ?? '',
        },
      },
    })

    // Get current subscription status summary across all tenants (not date-windowed).
    const allSubscriptions = await prisma.subscription.findMany({
      where: {
        tenantId: { not: user.tenantId ?? '' },
      },
      include: { plan: true },
    })

    const activeSubscriptions = allSubscriptions.filter((s) => s.status === 'ACTIVE').length
    const expiredSubscriptions = allSubscriptions.filter((s) => s.status === 'EXPIRED').length
    const suspendedSubscriptions = allSubscriptions.filter((s) => s.status === 'SUSPENDED').length

    // Calculate current active-subscription billing and build per-plan breakdown
    const activeSubscriptions_list = allSubscriptions.filter((s) => s.status === 'ACTIVE')
    const billingCurrencies = Array.from(
      new Set(
        activeSubscriptions_list
          .map((s) => (s as { billingCurrency?: string }).billingCurrency || 'USD')
          .filter((c) => c !== baseCurrency)
      )
    )

    const latestRates = fxTenantId && billingCurrencies.length > 0
      ? await prisma.currencyRate.findMany({
          where: {
            tenantId: fxTenantId,
            OR: [
              { fromCurrency: baseCurrency, toCurrency: { in: billingCurrencies } },
              { fromCurrency: { in: billingCurrencies }, toCurrency: baseCurrency },
            ],
          },
          orderBy: { date: 'desc' },
          select: { fromCurrency: true, toCurrency: true, rate: true },
        })
      : []

    const rateMap = new Map<string, number>()
    for (const fx of latestRates) {
      const key = `${fx.fromCurrency}->${fx.toCurrency}`
      if (!rateMap.has(key)) {
        rateMap.set(key, Number(fx.rate))
      }
    }

    const convertedRevenueMap = await Promise.all(
      activeSubscriptions_list.map(async (subscription) => {
        const amount = Number(subscription.amount)
        const billingCurrency = (subscription as { billingCurrency?: string }).billingCurrency || 'USD'
        if (billingCurrency === baseCurrency) {
          return { subscription, baseAmount: amount }
        }

        const directRate = rateMap.get(`${baseCurrency}->${billingCurrency}`)
        if (directRate && directRate > 0) {
          return { subscription, baseAmount: amount / directRate }
        }

        const inverseRate = rateMap.get(`${billingCurrency}->${baseCurrency}`)
        if (inverseRate && inverseRate > 0) {
          return { subscription, baseAmount: amount * inverseRate }
        }

        return { subscription, baseAmount: amount }
      })
    )
    const totalRevenue = convertedRevenueMap.reduce((sum, { baseAmount }) => sum + baseAmount, 0)

    // Lifetime and selected-period financial KPIs across tenant businesses (excluding platform owner)
    const [lifetimeSubscriptionTransactions, periodSubscriptionTransactions, allExpenses, periodExpenses] = await Promise.all([
      prisma.subscriptionTransaction.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          status: { in: ['ACTIVE', 'VERIFIED'] },
        },
        select: { amount: true, currency: true },
      }),
      prisma.subscriptionTransaction.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          status: { in: ['ACTIVE', 'VERIFIED'] },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { amount: true, currency: true },
      }),
      prisma.expense.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          archived: false,
        },
        select: { amount: true, currency: true, fxRate: true },
      }),
      prisma.expense.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          archived: false,
          date: { gte: startDate, lte: endDate },
        },
        select: { amount: true, currency: true, fxRate: true },
      }),
    ])

    const convertTransactionRows = async (rows: Array<{ amount: unknown; currency: string }>): Promise<number> => {
      const converted = await Promise.all(rows.map(async (row) => {
        const amount = toNumber(row.amount)
        if (row.currency === baseCurrency) return amount
        const rate = await getTransactionToBaseRate(fxTenantId, baseCurrency, row.currency)
        return amount / rate
      }))
      return converted.reduce((sum, val) => sum + val, 0)
    }

    const [lifetimeRevenue, periodRevenue] = await Promise.all([
      convertTransactionRows(lifetimeSubscriptionTransactions),
      convertTransactionRows(periodSubscriptionTransactions),
    ])

    const lifetimeExpenses = allExpenses.reduce(
      (sum, row) => sum + toBaseExpenseAmount(row.amount, row.fxRate, row.currency, baseCurrency),
      0,
    )
    const periodExpensesValue = periodExpenses.reduce(
      (sum, row) => sum + toBaseExpenseAmount(row.amount, row.fxRate, row.currency, baseCurrency),
      0,
    )

    const lifetimeProfit = lifetimeRevenue - lifetimeExpenses
    const periodProfit = periodRevenue - periodExpensesValue

    // Group active subscriptions by plan
    const planMap = new Map<string, { planId: string; planName: string; priceCurrency: string; count: number; revenue: number }>()
    for (const { subscription, baseAmount } of convertedRevenueMap) {
      const planId = subscription.planId
      const planName = subscription.plan?.name ?? planId
      const priceCurrency =
        (subscription as { billingCurrency?: string }).billingCurrency ||
        (subscription.plan as { priceCurrency?: string } | null)?.priceCurrency ||
        baseCurrency
      const existing = planMap.get(planId)
      if (existing) {
        existing.count += 1
        existing.revenue += baseAmount
      } else {
        planMap.set(planId, { planId, planName, priceCurrency, count: 1, revenue: baseAmount })
      }
    }
    const planBreakdown = Array.from(planMap.values()).sort((a, b) => b.revenue - a.revenue)

    const intervalRanges = buildIntervalRanges(period, startDate, endDate)

    // Build subscription trend from effective lifecycle timestamps for activations,
    // and subscription update timestamps for status transitions.
    const [activatedTransactions, expiredTransitions, suspendedTransitions] = await Promise.all([
      prisma.subscriptionTransaction.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          status: 'ACTIVE',
          OR: [
            { activatedAt: { gte: startDate, lte: endDate } },
            { verifiedAt: { gte: startDate, lte: endDate } },
            { initiatedAt: { gte: startDate, lte: endDate } },
          ],
        },
        select: { initiatedAt: true, verifiedAt: true, activatedAt: true },
      }),
      prisma.subscription.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          status: 'EXPIRED',
          updatedAt: { gte: startDate, lte: endDate },
        },
        select: { updatedAt: true },
      }),
      prisma.subscription.findMany({
        where: {
          tenantId: { not: user.tenantId ?? '' },
          status: 'SUSPENDED',
          updatedAt: { gte: startDate, lte: endDate },
        },
        select: { updatedAt: true },
      }),
    ])

    const activeEventDates = activatedTransactions
      .map((tx) => tx.activatedAt ?? tx.verifiedAt ?? tx.initiatedAt)
      .filter((d): d is Date => Boolean(d))

    const subscriptionTrend = intervalRanges.map((range) => ({
      date: range.date,
      active: activeEventDates.filter((d) => d >= range.start && d < range.end).length,
      expired: expiredTransitions.filter((s) => s.updatedAt >= range.start && s.updatedAt < range.end).length,
      suspended: suspendedTransitions.filter((s) => s.updatedAt >= range.start && s.updatedAt < range.end).length,
    }))

    // Company growth trend for date range
    const companiesByDate = await prisma.tenant.findMany({
      where: {
        id: { not: user.tenantId ?? '' },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { createdAt: true },
    })

    let runningCount = totalCompanies - companiesByDate.length
    const companyGrowth = intervalRanges.map((range) => {
      const newCompanies = companiesByDate.filter(
        (c) => c.createdAt >= range.start && c.createdAt < range.end
      ).length

      runningCount += newCompanies

      return { date: range.date, count: runningCount }
    })

    return NextResponse.json({
      data: {
        totalCompanies,
        totalSubsidiaries,
        activeSubscriptions,
        expiredSubscriptions,
        suspendedSubscriptions,
        totalRevenue,
        financials: {
          lifetime: {
            revenue: Number(lifetimeRevenue.toFixed(2)),
            expenses: Number(lifetimeExpenses.toFixed(2)),
            profit: Number(lifetimeProfit.toFixed(2)),
          },
          period: {
            key: period,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            revenue: Number(periodRevenue.toFixed(2)),
            expenses: Number(periodExpensesValue.toFixed(2)),
            profit: Number(periodProfit.toFixed(2)),
          },
        },
        baseCurrency,
        planBreakdown,
        subscriptionTrend,
        companyGrowth,
      },
    })
  } catch (err) {
    console.error('[PLATFORM STATS GET]', err)
    return apiError('Internal server error', 500)
  }
}
