import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { hasPermission, isSuperAdmin } from '@/lib/rbac'

function getDateRange(period: string, from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date()
  if (period === 'custom' && from && to) {
    return { start: new Date(from), end: new Date(to) }
  }

  const start = new Date(now)
  switch (period) {
    case 'daily':
      start.setDate(start.getDate() - 1)
      break
    case 'weekly':
      start.setDate(start.getDate() - 7)
      break
    case 'quarterly':
      start.setMonth(start.getMonth() - 3)
      break
    case 'yearly':
      start.setFullYear(start.getFullYear() - 1)
      break
    case 'monthly':
    default:
      start.setMonth(start.getMonth() - 1)
      break
  }

  return { start, end: now }
}

function toBaseCurrency(amount: number, currency: string, fxRate: number, baseCurrency: string): number {
  if (currency === baseCurrency) return amount
  if (!Number.isFinite(fxRate) || fxRate <= 0) return amount
  return amount / fxRate
}

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:analytics')) return apiError('Forbidden', 403)

    const requestedTenantId = new URL(req.url).searchParams.get('tenantId') || undefined
    const tenantId = isSuperAdmin(user)
      ? requestedTenantId || user.tenantId!
      : user.tenantId!

    if (!tenantId) {
      return apiError('No tenant context for this account. Provide tenantId.', 400)
    }

    const searchParams = new URL(req.url).searchParams
    const subsidiaryId = searchParams.get('subsidiaryId') || undefined
    const period = searchParams.get('period') || 'monthly'
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined

    const baseWhere = {
      tenantId,
      archived: false,
      ...(subsidiaryId ? { subsidiaryId } : {}),
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { baseCurrency: true },
    })
    const baseCurrency = tenant?.baseCurrency || 'USD'

    const now = new Date()

    // Today's date range
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    // This month's start
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const periodRange = getDateRange(period, from, to)

    // Build the 7-day trend date ranges (oldest first)
    const trendDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i))
      return {
        date: d.toISOString().slice(0, 10),
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
        end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
      }
    })

    // All aggregates fired in parallel ΓÇö single round-trip batch
    const [
      [todaySales, monthSales, monthExpenses, periodSales, periodExpenses, allSales, allExpenses, allActiveProducts, activeSubsidiaries, unreadNotifications],
      trendAggregates,
    ] = await Promise.all([
      Promise.all([
        // Today's sales (count + total)
        prisma.sale.findMany({
          where: { ...baseWhere, createdAt: { gte: todayStart, lte: todayEnd } },
          select: { totalAmount: true, currency: true, fxRate: true },
        }),
        // This month's revenue
        prisma.sale.findMany({
          where: { ...baseWhere, createdAt: { gte: monthStart } },
          select: { totalAmount: true, currency: true, fxRate: true },
        }),
        // This month's expenses
        prisma.expense.findMany({
          where: { ...baseWhere, date: { gte: monthStart } },
          select: { amount: true, currency: true, fxRate: true },
        }),
        // Selected period sales
        prisma.sale.findMany({
          where: { ...baseWhere, createdAt: { gte: periodRange.start, lte: periodRange.end } },
          select: { totalAmount: true, currency: true, fxRate: true },
        }),
        // Selected period expenses
        prisma.expense.findMany({
          where: { ...baseWhere, date: { gte: periodRange.start, lte: periodRange.end } },
          select: { amount: true, currency: true, fxRate: true },
        }),
        // Lifetime sales
        prisma.sale.findMany({
          where: { ...baseWhere },
          select: { totalAmount: true, currency: true, fxRate: true },
        }),
        // Lifetime expenses
        prisma.expense.findMany({
          where: { ...baseWhere },
          select: { amount: true, currency: true, fxRate: true },
        }),
        // All non-archived products ΓÇö used for both totalProducts and lowStockCount
        // (Prisma doesn't support column-vs-column comparisons, so we filter in app)
        prisma.product.findMany({
           where: { ...baseWhere, status: 'ACTIVE' },
          select: { quantity: true, lowStockThreshold: true, status: true },
        }),
        // Active subsidiaries count
        prisma.subsidiary.count({ where: { tenantId, archived: false, isActive: true } }),
        // Unread notifications count
        prisma.notification.count({ where: { tenantId, isRead: false } }),
      ]),
      // 7-day sales trend (one aggregate per day, fired in parallel with the main queries)
      Promise.all(
        trendDays.map(({ start, end }) =>
          prisma.sale.findMany({
            where: { ...baseWhere, createdAt: { gte: start, lte: end } },
            select: { totalAmount: true, currency: true, fxRate: true },
          })
        )
      ),
    ])

    const todaySalesTotal = todaySales.reduce((sum, sale) => {
      return sum + toBaseCurrency(Number(sale.totalAmount || 0), sale.currency, Number(sale.fxRate || 1), baseCurrency)
    }, 0)

    const monthSalesTotal = monthSales.reduce((sum, sale) => {
      return sum + toBaseCurrency(Number(sale.totalAmount || 0), sale.currency, Number(sale.fxRate || 1), baseCurrency)
    }, 0)

    const monthExpensesTotal = monthExpenses.reduce((sum, expense) => {
      return sum + toBaseCurrency(Number(expense.amount || 0), expense.currency, Number(expense.fxRate || 1), baseCurrency)
    }, 0)

    const periodRevenue = periodSales.reduce((sum, sale) => {
      return sum + toBaseCurrency(Number(sale.totalAmount || 0), sale.currency, Number(sale.fxRate || 1), baseCurrency)
    }, 0)

    const periodExpensesTotal = periodExpenses.reduce((sum, expense) => {
      return sum + toBaseCurrency(Number(expense.amount || 0), expense.currency, Number(expense.fxRate || 1), baseCurrency)
    }, 0)

    const lifetimeRevenue = allSales.reduce((sum, sale) => {
      return sum + toBaseCurrency(Number(sale.totalAmount || 0), sale.currency, Number(sale.fxRate || 1), baseCurrency)
    }, 0)

    const lifetimeExpenses = allExpenses.reduce((sum, expense) => {
      return sum + toBaseCurrency(Number(expense.amount || 0), expense.currency, Number(expense.fxRate || 1), baseCurrency)
    }, 0)

    // Derive product stats from the single products query
    const totalProducts = allActiveProducts.length  // all are ACTIVE (filtered in query)
    const lowStockCount = allActiveProducts.filter(
      (p) => Number(p.quantity) <= Number(p.lowStockThreshold)
    ).length

    // Map trend aggregates back to { date, revenue } ΓÇö zero-filled for days with no sales
    const salesTrend = trendDays.map(({ date }, i) => ({
      date,
      total: trendAggregates[i].reduce((sum, sale) => {
        return sum + toBaseCurrency(Number(sale.totalAmount || 0), sale.currency, Number(sale.fxRate || 1), baseCurrency)
      }, 0),
      revenue: trendAggregates[i].reduce((sum, sale) => {
        return sum + toBaseCurrency(Number(sale.totalAmount || 0), sale.currency, Number(sale.fxRate || 1), baseCurrency)
      }, 0),
    }))

    return NextResponse.json({
      data: {
        salesThisMonth: monthSalesTotal,
        salesCount: monthSales.length,
        todaySalesCount: todaySales.length,
        todaySalesTotal,
        revenueThisMonth: monthSalesTotal,
        expensesThisMonth: monthExpensesTotal,
        totalProducts,
        lowStockCount,
        activeSubsidiaries,
        unreadNotifications,
        salesTrend,
        baseCurrency,
        financials: {
          lifetime: {
            revenue: Number(lifetimeRevenue.toFixed(2)),
            expenses: Number(lifetimeExpenses.toFixed(2)),
            profit: Number((lifetimeRevenue - lifetimeExpenses).toFixed(2)),
          },
          period: {
            key: period,
            startDate: periodRange.start.toISOString(),
            endDate: periodRange.end.toISOString(),
            revenue: Number(periodRevenue.toFixed(2)),
            expenses: Number(periodExpensesTotal.toFixed(2)),
            profit: Number((periodRevenue - periodExpensesTotal).toFixed(2)),
          },
        },
      },
    })
  } catch (err) {
    console.error('[DASHBOARD GET]', err)
    return apiError('Internal server error', 500)
  }
}
