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

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!hasPermission(user, 'view:reports')) return apiError('Forbidden', 403)

    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || 'monthly'
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const subsidiaryId = searchParams.get('subsidiaryId') || undefined

    const tenantId = isSuperAdmin(user)
      ? searchParams.get('tenantId') || undefined
      : user.tenantId!

    const dateRange = getDateRange(period, from, to)
    const baseWhere = {
      tenantId,
      archived: false,
      ...(subsidiaryId ? { subsidiaryId } : {}),
    }

    // Aggregate sales
    const salesAgg = await prisma.sale.aggregate({
      where: { ...baseWhere, ...(dateRange ? { createdAt: dateRange } : {}) },
      _sum: { totalAmount: true, discount: true },
      _count: { id: true },
    })

    // Cost of goods sold
    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: { ...baseWhere, ...(dateRange ? { createdAt: dateRange } : {}) },
      },
      select: { quantity: true, costPrice: true, subtotal: true },
    })

    const cogs = saleItems.reduce((s, i) => s + Number(i.quantity) * Number(i.costPrice), 0)
    const totalSales = Number(salesAgg._sum.totalAmount || 0)

    // Expenses
    const expensesAgg = await prisma.expense.aggregate({
      where: { ...baseWhere, ...(dateRange ? { date: dateRange } : {}) },
      _sum: { amount: true },
    })
    const totalExpenses = Number(expensesAgg._sum.amount || 0)

    // Product inventory worth
    const products = await prisma.product.findMany({
      where: { ...baseWhere, status: { in: ['ACTIVE', 'DRAFT'] } },
      select: { quantity: true, costPrice: true },
    })
    const totalProductWorth = products.reduce(
      (s, p) => s + Number(p.quantity) * Number(p.costPrice),
      0
    )

    const grossProfit = totalSales - cogs
    const netProfit = grossProfit - totalExpenses

    // Top products by quantity sold (last 30 days max)
    const topProducts = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: { ...baseWhere, ...(dateRange ? { createdAt: dateRange } : {}) },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    })

    const topProductDetails = await Promise.all(
      topProducts.map(async (tp) => {
        const product = await prisma.product.findUnique({
          where: { id: tp.productId },
          select: { name: true, unit: true },
        })
        return {
          productId: tp.productId,
          name: product?.name || 'Unknown',
          unit: product?.unit || 'pcs',
          totalQuantity: Number(tp._sum.quantity),
          totalRevenue: Number(tp._sum.subtotal),
        }
      })
    )

    // Expense breakdown by category
    const expenseByCategory = await prisma.expense.groupBy({
      by: ['category'],
      where: { ...baseWhere, ...(dateRange ? { date: dateRange } : {}) },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    })

    return NextResponse.json({
      data: {
        summary: {
          totalSales,
          totalExpenses,
          cogs,
          grossProfit,
          netProfit,
          totalProductWorth,
          salesCount: salesAgg._count.id,
        },
        topProducts: topProductDetails,
        expenseByCategory: expenseByCategory.map((e) => ({
          category: e.category,
          total: Number(e._sum.amount),
        })),
        period,
      },
    })
  } catch (err) {
    console.error('[REPORTS GET]', err)
    return apiError('Internal server error', 500)
  }
}
