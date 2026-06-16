import { Prisma, ProductReceiptSource, ProductType } from '@prisma/client'

type ProductReceiptSyncInput = {
  id: string
  tenantId: string
  subsidiaryId: string
  type: ProductType
  quantity: Prisma.Decimal | number
  costPrice: Prisma.Decimal | number
  purchaseDate: Date | null
}

function toNumber(value: Prisma.Decimal | number): number {
  return Number(value || 0)
}

function sameTimestamp(left: Date | null, right: Date | null): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.getTime() === right.getTime()
}

function hasPositiveGoodsQuantity(product: ProductReceiptSyncInput): boolean {
  return product.type === ProductType.GOODS && toNumber(product.quantity) > 0
}

export async function syncProductReceiptHistory(args: {
  tx: Prisma.TransactionClient
  previousProduct: ProductReceiptSyncInput | null
  nextProduct: ProductReceiptSyncInput
  userId: string
}): Promise<void> {
  const { tx, previousProduct, nextProduct, userId } = args

  if (nextProduct.type !== ProductType.GOODS) {
    return
  }

  const nextQuantity = toNumber(nextProduct.quantity)
  const previousQuantity = previousProduct ? toNumber(previousProduct.quantity) : 0
  const quantityIncrease = Math.max(0, nextQuantity - previousQuantity)
  const hasExistingReceipts = await tx.productReceipt.count({ where: { productId: nextProduct.id } }) > 0

  if (!previousProduct && hasPositiveGoodsQuantity(nextProduct) && nextProduct.purchaseDate) {
    await tx.productReceipt.create({
      data: {
        tenantId: nextProduct.tenantId,
        subsidiaryId: nextProduct.subsidiaryId,
        productId: nextProduct.id,
        quantity: nextQuantity,
        unitCost: toNumber(nextProduct.costPrice),
        purchaseDate: nextProduct.purchaseDate,
        source: ProductReceiptSource.INITIAL_STOCK,
        isEstimated: false,
        createdBy: userId,
        updatedBy: userId,
      },
    })
    return
  }

  if (!hasExistingReceipts && hasPositiveGoodsQuantity(nextProduct) && nextProduct.purchaseDate) {
    await tx.productReceipt.create({
      data: {
        tenantId: nextProduct.tenantId,
        subsidiaryId: nextProduct.subsidiaryId,
        productId: nextProduct.id,
        quantity: nextQuantity,
        unitCost: toNumber(nextProduct.costPrice),
        purchaseDate: nextProduct.purchaseDate,
        source: ProductReceiptSource.INITIAL_STOCK,
        isEstimated: false,
        createdBy: userId,
        updatedBy: userId,
      },
    })
    return
  }

  const purchaseDateChanged = !sameTimestamp(previousProduct?.purchaseDate || null, nextProduct.purchaseDate)
  const costChanged = previousProduct ? toNumber(previousProduct.costPrice) !== toNumber(nextProduct.costPrice) : false

  if ((purchaseDateChanged || costChanged) && nextProduct.purchaseDate) {
    const earliestReceipt = await tx.productReceipt.findFirst({
      where: { productId: nextProduct.id },
      orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, source: true },
    })

    if (earliestReceipt) {
      await tx.productReceipt.update({
        where: { id: earliestReceipt.id },
        data: {
          purchaseDate: nextProduct.purchaseDate,
          ...(earliestReceipt.source === ProductReceiptSource.INITIAL_STOCK ? { unitCost: toNumber(nextProduct.costPrice) } : {}),
          isEstimated: false,
          updatedBy: userId,
        },
      })
    }
  }

  if (quantityIncrease > 0 && nextProduct.purchaseDate) {
    await tx.productReceipt.create({
      data: {
        tenantId: nextProduct.tenantId,
        subsidiaryId: nextProduct.subsidiaryId,
        productId: nextProduct.id,
        quantity: quantityIncrease,
        unitCost: toNumber(nextProduct.costPrice),
        purchaseDate: nextProduct.purchaseDate,
        source: hasExistingReceipts ? ProductReceiptSource.RESTOCK : ProductReceiptSource.INITIAL_STOCK,
        isEstimated: false,
        notes: hasExistingReceipts ? 'Recorded from product stock increase.' : undefined,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  }
}