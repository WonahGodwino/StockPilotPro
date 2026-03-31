import { prisma } from './prisma'
import { ProductStatus } from '@prisma/client'

/**
 * Checks all products in a subsidiary for low stock and
 * creates notifications for products below their threshold.
 */
export async function checkLowStockAlerts(tenantId: string, subsidiaryId: string) {
  const products = await prisma.product.findMany({
    where: {
      tenantId,
      subsidiaryId,
      status: ProductStatus.ACTIVE,
      archived: false,
    },
  })

  const lowStockProducts = products.filter(
    (p) => Number(p.quantity) <= Number(p.lowStockThreshold)
  )

  for (const product of lowStockProducts) {
    // Avoid duplicate notifications for the same product (from today)
    const existingToday = await prisma.notification.findFirst({
      where: {
        tenantId,
        productId: product.id,
        type: 'LOW_STOCK',
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    })

    if (!existingToday) {
      await prisma.notification.create({
        data: {
          tenantId,
          subsidiaryId,
          productId: product.id,
          type: 'LOW_STOCK',
          title: 'Low Stock Alert',
          message: `"${product.name}" is running low. Current stock: ${product.quantity} ${product.unit}`,
        },
      })
    }
  }

  return lowStockProducts.length
}

/**
 * Checks and updates subscription status for expired subscriptions.
 */
export async function checkSubscriptionExpiry() {
  const now = new Date()

  await prisma.subscription.updateMany({
    where: {
      expiryDate: { lt: now },
      status: 'ACTIVE',
    },
    data: { status: 'EXPIRED' },
  })
}

/**
 * Generate a unique receipt number.
 */
export function generateReceiptNumber(): string {
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `RCP-${dateStr}-${random}`
}
