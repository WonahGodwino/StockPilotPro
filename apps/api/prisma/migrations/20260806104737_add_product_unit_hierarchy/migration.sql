-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "keepingToSellingRate" DECIMAL(12,4),
ADD COLUMN     "keepingUnit" TEXT,
ADD COLUMN     "purchaseToKeepingRate" DECIMAL(12,4),
ADD COLUMN     "purchaseUnit" TEXT,
ADD COLUMN     "sellingUnit" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "unitSold" TEXT;

