-- Create enums for subscription transaction workflow
CREATE TYPE "SubscriptionChangeType" AS ENUM ('NEW', 'RENEW', 'UPGRADE');
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('PAYSTACK', 'TRANSFER', 'MANUAL');
CREATE TYPE "SubscriptionTransactionStatus" AS ENUM ('PENDING_PAYMENT', 'PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'REJECTED', 'CANCELLED');

-- Create subscription transaction ledger
CREATE TABLE "SubscriptionTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "currentPlanId" TEXT,
    "requestedPlanId" TEXT NOT NULL,
    "changeType" "SubscriptionChangeType" NOT NULL,
    "paymentMethod" "SubscriptionPaymentMethod" NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "SubscriptionTransactionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paystackReference" TEXT,
    "paystackAccessCode" TEXT,
    "paymentProviderResponse" JSONB,
    "transferProofUrl" TEXT,
    "transferProofNote" TEXT,
    "initiatedByUserId" TEXT,
    "verifiedByUserId" TEXT,
    "activatedByUserId" TEXT,
    "modifiedByUserId" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "modifiedAt" TIMESTAMP(3),
    "lifecycleEvents" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionTransaction_paystackReference_key" ON "SubscriptionTransaction"("paystackReference");
CREATE INDEX "SubscriptionTransaction_tenantId_createdAt_idx" ON "SubscriptionTransaction"("tenantId", "createdAt");
CREATE INDEX "SubscriptionTransaction_tenantId_status_idx" ON "SubscriptionTransaction"("tenantId", "status");
CREATE INDEX "SubscriptionTransaction_status_createdAt_idx" ON "SubscriptionTransaction"("status", "createdAt");

ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_currentPlanId_fkey"
  FOREIGN KEY ("currentPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_requestedPlanId_fkey"
  FOREIGN KEY ("requestedPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_verifiedByUserId_fkey"
  FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_activatedByUserId_fkey"
  FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionTransaction" ADD CONSTRAINT "SubscriptionTransaction_modifiedByUserId_fkey"
  FOREIGN KEY ("modifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
