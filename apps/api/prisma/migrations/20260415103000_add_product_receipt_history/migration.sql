-- Add product purchase provenance fields.
ALTER TABLE "Product"
    ADD COLUMN "purchaseDate" TIMESTAMP(3);

-- Legacy products can only be backfilled from creation metadata.
UPDATE "Product"
SET "purchaseDate" = "createdAt"
WHERE "purchaseDate" IS NULL
  AND "type" = 'GOODS'
  AND "quantity" > 0;

-- CreateEnum: ProductReceiptSource
CREATE TYPE "ProductReceiptSource" AS ENUM ('INITIAL_STOCK', 'RESTOCK', 'LEGACY_IMPORT');

-- CreateTable: ProductReceipt
CREATE TABLE "ProductReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subsidiaryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "source" "ProductReceiptSource" NOT NULL DEFAULT 'INITIAL_STOCK',
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "ProductReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductReceipt"
    ADD CONSTRAINT "ProductReceipt_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductReceipt"
    ADD CONSTRAINT "ProductReceipt_subsidiaryId_fkey"
    FOREIGN KEY ("subsidiaryId") REFERENCES "Subsidiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductReceipt"
    ADD CONSTRAINT "ProductReceipt_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ProductReceipt_tenantId_idx" ON "ProductReceipt"("tenantId");
CREATE INDEX "ProductReceipt_subsidiaryId_idx" ON "ProductReceipt"("subsidiaryId");
CREATE INDEX "ProductReceipt_productId_purchaseDate_idx" ON "ProductReceipt"("productId", "purchaseDate");

INSERT INTO "ProductReceipt" (
    "id",
    "tenantId",
    "subsidiaryId",
    "productId",
    "quantity",
    "unitCost",
    "purchaseDate",
    "source",
    "isEstimated",
    "notes",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy"
)
SELECT
    'legacy_receipt_' || "id",
    "tenantId",
    "subsidiaryId",
    "id",
    "quantity",
    "costPrice",
    COALESCE("purchaseDate", "createdAt"),
    'LEGACY_IMPORT'::"ProductReceiptSource",
    true,
    'Backfilled from product.createdAt during provenance migration.',
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy"
FROM "Product"
WHERE "type" = 'GOODS'
  AND "quantity" > 0;