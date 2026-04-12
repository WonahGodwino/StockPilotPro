-- Add category to products with a safe default for existing rows
ALTER TABLE "Product"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Uncategorized';

-- Optional helper index for category analytics/filtering
CREATE INDEX "Product_category_idx" ON "Product"("category");
