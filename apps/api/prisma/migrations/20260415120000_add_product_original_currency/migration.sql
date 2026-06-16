-- Add original entry currency provenance to Product.
-- When a product is entered in a foreign currency the original amounts and
-- currency code are preserved so the UI can always show the source price
-- alongside the current base-currency equivalent.

ALTER TABLE "Product"
    ADD COLUMN "originalCurrency"     TEXT,
    ADD COLUMN "originalCostPrice"    DECIMAL(12,2),
    ADD COLUMN "originalSellingPrice" DECIMAL(12,2);
