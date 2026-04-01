-- Add plan price currency and subscription billing currency
ALTER TABLE "Plan"
ADD COLUMN "priceCurrency" TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE "Subscription"
ADD COLUMN "billingCurrency" TEXT NOT NULL DEFAULT 'USD';

-- Backfill existing subscriptions from their linked plan currency where available
UPDATE "Subscription" s
SET "billingCurrency" = p."priceCurrency"
FROM "Plan" p
WHERE s."planId" = p."id";
