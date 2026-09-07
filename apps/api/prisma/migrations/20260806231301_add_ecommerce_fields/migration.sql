/*
  Warnings:

  - You are about to drop the column `keepingToSellingRate` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `keepingUnit` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `purchaseToKeepingRate` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `purchaseUnit` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `sellingUnit` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `unitSold` on the `SaleItem` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('POS', 'ONLINE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE';

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_subsidiaryId_fkey";

-- DropIndex
DROP INDEX "Product_category_idx";

-- DropIndex
DROP INDEX "SubscriptionTransaction_transferProofUploadedByUserId_idx";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "keepingToSellingRate",
DROP COLUMN "keepingUnit",
DROP COLUMN "purchaseToKeepingRate",
DROP COLUMN "purchaseUnit",
DROP COLUMN "sellingUnit",
ADD COLUMN     "salesUnits" JSONB DEFAULT '[]';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "orderStatus" "OrderStatus",
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "source" "SaleSource" NOT NULL DEFAULT 'POS';

-- AlterTable
ALTER TABLE "SaleItem" DROP COLUMN "unitSold";

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBrand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Uncategorized',
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "purchaseUnit" TEXT,
    "keepingUnit" TEXT,
    "sellingUnit" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gateway" TEXT NOT NULL DEFAULT 'PAYSTACK',
    "gatewayResponse" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductCategory_tenantId_idx" ON "ProductCategory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_tenantId_name_key" ON "ProductCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ProductBrand_tenantId_idx" ON "ProductBrand"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBrand_tenantId_name_key" ON "ProductBrand"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCatalog_name_key" ON "ProductCatalog"("name");

-- CreateIndex
CREATE INDEX "ProductCatalog_name_idx" ON "ProductCatalog"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_reference_key" ON "PaymentTransaction"("reference");

-- CreateIndex
CREATE INDEX "PaymentTransaction_tenantId_idx" ON "PaymentTransaction"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_reference_idx" ON "PaymentTransaction"("reference");

-- CreateIndex
CREATE INDEX "PaymentTransaction_saleId_idx" ON "PaymentTransaction"("saleId");

-- CreateIndex
CREATE INDEX "Sale_source_idx" ON "Sale"("source");

-- CreateIndex
CREATE INDEX "Sale_orderStatus_idx" ON "Sale"("orderStatus");

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBrand" ADD CONSTRAINT "ProductBrand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_subsidiaryId_fkey" FOREIGN KEY ("subsidiaryId") REFERENCES "Subsidiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "EnterpriseAiExternalDataConnection_tenantId_groundingEnabled_id" RENAME TO "EnterpriseAiExternalDataConnection_tenantId_groundingEnable_idx";

-- RenameIndex
ALTER INDEX "EnterpriseAiRecommendation_tenantId_recommendationType_createdA" RENAME TO "EnterpriseAiRecommendation_tenantId_recommendationType_crea_idx";

-- RenameIndex
ALTER INDEX "EnterpriseAiRecommendationDecision_recommendationId_createdAt_i" RENAME TO "EnterpriseAiRecommendationDecision_recommendationId_created_idx";
