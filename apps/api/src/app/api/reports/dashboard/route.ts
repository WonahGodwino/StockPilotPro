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

    // This month
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    const [salesThisMonth, expensesThisMonth, lowStockCount, totalProducts, activeSubsidiaries, unreadNotifications] =
      await Promise.all([
        prisma.sale.aggregate({
          where: { ...baseWhere, createdAt: { gte: monthStart } },
          _sum: { totalAmount: true },
          _count: { id: true },
        }),
        prisma.expense.aggregate({
          where: { ...baseWhere, date: { gte: monthStart } },
          _sum: { amount: true },
        }),
        prisma.product.count({
          where: {
            ...baseWhere,
            status: 'ACTIVE',
            // Low stock: where quantity <= lowStockThreshold
            // Prisma doesn't directly support column comparison, so we do it in app
          },
        }),
        prisma.product.count({ where: { ...baseWhere, archived: false } }),
        prisma.subsidiary.count({ where: { tenantId, archived: false, isActive: true } }),
        prisma.notification.count({
          where: { tenantId, isRead: false },
        }),
      ])

    // Get all products to calculate low stock in app
    const products = await prisma.product.findMany({
      where: { ...baseWhere, status: 'ACTIVE', archived: false },
      select: { quantity: true, lowStockThreshold: true },
    })
    const lowStock = products.filter((p) => Number(p.quantity) <= Number(p.lowStockThreshold)).length

    // Sales trend (last 7 days)
    const salesTrend = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const start = new Date(d.setHours(0, 0, 0, 0))
        const end = new Date(d.setHours(23, 59, 59, 999))
        return prisma.sale
          .aggregate({
            where: { ...baseWhere, createdAt: { gte: start, lte: end } },
            _sum: { totalAmount: true },
          })
          .then((r) => ({
            date: start.toISOString().slice(0, 10),
            total: Number(r._sum.totalAmount || 0),
          }))
      })
    )

    return NextResponse.json({
      data: {
        salesThisMonth: Number(salesThisMonth._sum.totalAmount || 0),
        salesCount: salesThisMonth._count.id,
        expensesThisMonth: Number(expensesThisMonth._sum.amount || 0),
        lowStockCount: lowStock,
        totalProducts,
        activeSubsidiaries,
        unreadNotifications,
        salesTrend: salesTrend.reverse(),
      },
    })
  } catch (err) {
    console.error('[DASHBOARD GET]', err)
    return apiError('Internal server error', 500)
  }
}
