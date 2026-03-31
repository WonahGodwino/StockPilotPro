import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { hasPermission, isSuperAdmin } from '@/lib/rbac'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:analytics')) return apiError('Forbidden', 403)

    const tenantId = isSuperAdmin(user)
      ? new URL(req.url).searchParams.get('tenantId') || undefined
      : user.tenantId!

    const subsidiaryId = new URL(req.url).searchParams.get('subsidiaryId') || undefined

    const baseWhere = {
      tenantId,
      archived: false,
      ...(subsidiaryId ? { subsidiaryId } : {}),
    }

    const now = new Date()

    // Today's date range
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    // This month's start
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

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
      [todaySales, monthSales, monthExpenses, allActiveProducts, activeSubsidiaries, unreadNotifications],
      trendAggregates,
    ] = await Promise.all([
      Promise.all([
        // Today's sales (count + total)
        prisma.sale.aggregate({
          where: { ...baseWhere, createdAt: { gte: todayStart, lte: todayEnd } },
          _sum: { totalAmount: true },
          _count: { id: true },
        }),
        // This month's revenue
        prisma.sale.aggregate({
          where: { ...baseWhere, createdAt: { gte: monthStart } },
          _sum: { totalAmount: true },
        }),
        // This month's expenses
        prisma.expense.aggregate({
          where: { ...baseWhere, date: { gte: monthStart } },
          _sum: { amount: true },
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
          prisma.sale.aggregate({
            where: { ...baseWhere, createdAt: { gte: start, lte: end } },
            _sum: { totalAmount: true },
          })
        )
      ),
    ])

    // Derive product stats from the single products query
    const totalProducts = allActiveProducts.length  // all are ACTIVE (filtered in query)
    const lowStockCount = allActiveProducts.filter(
      (p) => Number(p.quantity) <= Number(p.lowStockThreshold)
    ).length

    // Map trend aggregates back to { date, revenue } ΓÇö zero-filled for days with no sales
    const salesTrend = trendDays.map(({ date }, i) => ({
      date,
      revenue: Number(trendAggregates[i]._sum.totalAmount || 0),
    }))

    return NextResponse.json({
      data: {
        todaySalesCount: todaySales._count.id,
        todaySalesTotal: Number(todaySales._sum.totalAmount || 0),
        revenueThisMonth: Number(monthSales._sum.totalAmount || 0),
        expensesThisMonth: Number(monthExpenses._sum.amount || 0),
        totalProducts,
        lowStockCount,
        activeSubsidiaries,
        unreadNotifications,
        salesTrend,
      },
    })
  } catch (err) {
    console.error('[DASHBOARD GET]', err)
    return apiError('Internal server error', 500)
  }
}
