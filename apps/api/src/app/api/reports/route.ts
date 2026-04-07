import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin, hasPermission } from '@/lib/rbac'

function getDateRange(period: string, from?: string, to?: string) {
  const now = new Date()
  if (from && to) return { gte: new Date(from), lte: new Date(to) }

  switch (period) {
    case 'daily':
      return { gte: new Date(now.setHours(0, 0, 0, 0)), lte: new Date() }
    case 'weekly': {
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return { gte: start, lte: new Date() }
    }
    case 'monthly': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { gte: start, lte: new Date() }
    }
    case 'quarterly': {
      const q = Math.floor(now.getMonth() / 3)
      const start = new Date(now.getFullYear(), q * 3, 1)
      return { gte: start, lte: new Date() }
    }
    case 'yearly': {
      const start = new Date(now.getFullYear(), 0, 1)
      return { gte: start, lte: new Date() }
    }
    default:
      return undefined
  }
}

export async function OPTIONS() {
  return handleOptions()
}

async function getUsdToBaseRate(tenantId: string, baseCurrency: string): Promise<number> {
  if (baseCurrency === 'USD') return 1

  const direct = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency: 'USD', toCurrency: baseCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (direct?.rate) return Number(direct.rate)

  const inverse = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency: baseCurrency, toCurrency: 'USD' },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (inverse?.rate) return 1 / Number(inverse.rate)

  // Fallback to 1 when no FX snapshot is configured.
  return 1
}

async function getTransactionToBaseRate(tenantId: string, baseCurrency: string, transactionCurrency: string): Promise<number> {
  if (transactionCurrency === baseCurrency) return 1

  const direct = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency: baseCurrency, toCurrency: transactionCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (direct?.rate) return Number(direct.rate)

  const inverse = await prisma.currencyRate.findFirst({
    where: { tenantId, fromCurrency: transactionCurrency, toCurrency: baseCurrency },
    orderBy: { date: 'desc' },
    select: { rate: true },
  })
  if (inverse?.rate) return 1 / Number(inverse.rate)

  return 1
}

function toBaseExpenseAmount(amountRaw: unknown, fxRateRaw: unknown, currency: string, baseCurrency: string): number {
  const amount = Number(amountRaw)
  if (!Number.isFinite(amount)) return 0
  if (currency === baseCurrency) return amount

  const rate = Number(fxRateRaw)
  if (!Number.isFinite(rate) || rate <= 0) return amount
  return amount / rate
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:reports')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || 'monthly'
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const subsidiaryId = searchParams.get('subsidiaryId') || undefined
    const requestedTenantId = searchParams.get('tenantId') || undefined

    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account. Provide tenantId.', 400)
    }

    const isPlatformReport = isSuperAdmin(user) && tenantId === user.tenantId

    // Fetch tenant base currency
    const tenant = tenantId
      ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { baseCurrency: true } })
      : null
    const baseCurrency = tenant?.baseCurrency || 'USD'

    const dateRange = getDateRange(period, from, to)
    const baseWhere = {
      tenantId,
      archived: false,
      ...(subsidiaryId ? { subsidiaryId } : {}),
    }

    // Aggregate sales (with currency/fxRate for conversion)
    const sales = await prisma.sale.findMany({
      where: { ...baseWhere, ...(dateRange ? { createdAt: dateRange } : {}) },
      select: { totalAmount: true, discount: true, currency: true, fxRate: true, id: true },
    })

    // Convert each sale's totalAmount to base currency
    const totalSales = (sales as Array<{ totalAmount: unknown; discount: unknown; currency: string; fxRate: unknown; id: string }>).reduce((s: number, sale) => {
      const amount = Number(sale.totalAmount)
      const rate = Number(sale.fxRate)
      return s + (sale.currency === baseCurrency ? amount : amount / rate)
    }, 0)

    const salesCount = sales.length

    // Cost of goods sold — fetch all sale items once for both COGS and top products
    const saleIds = (sales as Array<{ id: string }>).map((s) => s.id)

    // Build a lookup of fxRate per saleId
    const saleFxMap: Record<string, { currency: string; fxRate: number }> = Object.fromEntries(
      (sales as Array<{ id: string; currency: string; fxRate: unknown }>).map((s) => [s.id, { currency: s.currency, fxRate: Number(s.fxRate) }])
    )

    const saleItemsAll = await prisma.saleItem.findMany({
      where: { saleId: { in: saleIds } },
      select: { productId: true, quantity: true, costPrice: true, subtotal: true, saleId: true },
    })

    const cogs = (saleItemsAll as Array<{ quantity: unknown; costPrice: unknown; saleId: string; productId: string; subtotal: unknown }>).reduce((s: number, i) => {
      const itemCogs = Number(i.quantity) * Number(i.costPrice)
      const { currency, fxRate } = saleFxMap[i.saleId] || { currency: baseCurrency, fxRate: 1 }
      return s + (currency === baseCurrency ? itemCogs : itemCogs / fxRate)
    }, 0)

    // Expenses (converted to base currency)
    const expensesRaw = await prisma.expense.findMany({
      where: { ...baseWhere, ...(dateRange ? { date: dateRange } : {}) },
      select: { amount: true, category: true, currency: true, fxRate: true },
    })

    const totalExpenses = (expensesRaw as Array<{ amount: unknown; category: string; currency: string; fxRate: unknown }>).reduce((s: number, e) => {
      return s + toBaseExpenseAmount(e.amount, e.fxRate, e.currency, baseCurrency)
    }, 0)

    // Expense breakdown by category (in base currency)
    const expenseByCatMap: Record<string, number> = {}
    for (const e of expensesRaw) {
      const converted = toBaseExpenseAmount(e.amount, e.fxRate, e.currency, baseCurrency)
      expenseByCatMap[e.category] = (expenseByCatMap[e.category] || 0) + converted
    }

    // Product inventory worth (products are always in base currency)
    const products = await prisma.product.findMany({
      where: { ...baseWhere, status: { in: ['ACTIVE', 'DRAFT'] } },
      select: { quantity: true, costPrice: true },
    })
    const totalProductWorth = (products as Array<{ quantity: unknown; costPrice: unknown }>).reduce(
      (s: number, p) => s + Number(p.quantity) * Number(p.costPrice),
      0
    )

    let subscriptionRevenueNative = 0
    let subscriptionRevenue = 0
    let subscriptionBillingCurrency: string | undefined

    if (isPlatformReport) {
      const subscriptionWhere = {
        status: 'ACTIVE' as const,
        tenantId: { not: tenantId },
        ...(dateRange ? { startDate: dateRange } : {}),
      }

      const subscriptions = await prisma.subscription.findMany({
        where: subscriptionWhere,
        select: { amount: true, billingCurrency: true },
      })

      const distinctBillingCurrencies = Array.from(new Set(subscriptions.map((s) => s.billingCurrency || 'USD')))
      subscriptionBillingCurrency = distinctBillingCurrencies.length === 1 ? distinctBillingCurrencies[0] : 'MIXED'

      if (distinctBillingCurrencies.length === 1) {
        subscriptionRevenueNative = subscriptions.reduce((sum, s) => sum + Number(s.amount), 0)
      }

      const convertedSubscriptions = await Promise.all(
        subscriptions.map(async (subscription) => {
          const amount = Number(subscription.amount)
          const billingCurrency = subscription.billingCurrency || 'USD'
          const rate = await getTransactionToBaseRate(tenantId!, baseCurrency, billingCurrency)
          return billingCurrency === baseCurrency ? amount : amount / rate
        })
      )
      subscriptionRevenue = convertedSubscriptions.reduce((sum, amount) => sum + amount, 0)
    }

    const operatingRevenue = totalSales
    const totalRevenue = operatingRevenue + subscriptionRevenue
    const grossProfit = totalRevenue - cogs
    const netProfit = grossProfit - totalExpenses

    // Top products by converted revenue
    const allSaleItems = saleItemsAll
    const productRevenueMap: Record<string, { quantity: number; revenue: number }> = {}
    for (const item of allSaleItems) {
      const { currency, fxRate } = saleFxMap[item.saleId] || { currency: baseCurrency, fxRate: 1 }
      const subtotal = Number(item.subtotal)
      const converted = currency === baseCurrency ? subtotal : subtotal / fxRate
      if (!productRevenueMap[item.productId]) {
        productRevenueMap[item.productId] = { quantity: 0, revenue: 0 }
      }
      productRevenueMap[item.productId].quantity += Number(item.quantity)
      productRevenueMap[item.productId].revenue += converted
    }

    const sortedProductIds = Object.entries(productRevenueMap)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([id]) => id)

    const topProductDetails = await Promise.all(
      sortedProductIds.map(async (productId) => {
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { name: true, unit: true },
        })
        return {
          productId,
          name: product?.name || 'Unknown',
          unit: product?.unit || 'pcs',
          totalQuantity: productRevenueMap[productId].quantity,
          totalRevenue: productRevenueMap[productId].revenue,
        }
      })
    )

    return NextResponse.json({
      data: {
        summary: {
          totalSales: totalRevenue,
          operatingRevenue,
          subscriptionRevenue,
          subscriptionRevenueNative,
          subscriptionBillingCurrency,
          costOfGoods: cogs,
          cogs,
          grossProfit,
          totalExpenses,
          netProfit,
          totalProductWorth,
          salesCount,
        },
        baseCurrency,
        topProducts: topProductDetails,
        expenseByCategory: Object.entries(expenseByCatMap).map(([category, total]) => ({
          category,
          total,
        })),
        // Legacy fields for backward compatibility
        totalSales: totalRevenue,
        operatingRevenue,
        subscriptionRevenue,
        subscriptionRevenueNative,
        subscriptionBillingCurrency,
        costOfGoods: cogs,
        grossProfit,
        totalExpenses,
        netProfit,
        totalProductWorth,
        expensesByCategory: expenseByCatMap,
        period,
      },
    })
  } catch (err) {
    console.error('[REPORTS GET]', err)
    return apiError('Internal server error', 500)
  }
}
