-- Migration: add_multi_currency
-- Adds baseCurrency to Tenant, currency+fxRate to Sale and Expense,
-- and introduces the CurrencyRate model for FX snapshots.

-- Add baseCurrency to Tenant
ALTER TABLE "Tenant" ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'USD';

-- Add currency and fxRate to Sale
ALTER TABLE "Sale" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Sale" ADD COLUMN "fxRate"    DECIMAL(18, 8) NOT NULL DEFAULT 1;

-- Add currency and fxRate to Expense
ALTER TABLE "Expense" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Expense" ADD COLUMN "fxRate"    DECIMAL(18, 8) NOT NULL DEFAULT 1;

-- Create CurrencyRate table
CREATE TABLE "CurrencyRate" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency"   TEXT NOT NULL,
    "rate"         DECIMAL(18, 8) NOT NULL,
    "date"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"    TEXT,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- Foreign key
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "CurrencyRate_tenantId_idx" ON "CurrencyRate"("tenantId");
CREATE INDEX "CurrencyRate_date_idx" ON "CurrencyRate"("date");
CREATE INDEX "CurrencyRate_fromCurrency_toCurrency_idx" ON "CurrencyRate"("fromCurrency", "toCurrency");
