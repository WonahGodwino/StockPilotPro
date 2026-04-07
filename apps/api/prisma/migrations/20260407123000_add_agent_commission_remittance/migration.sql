-- CreateEnum
CREATE TYPE "AgentCommissionPaymentStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "AgentCommissionRemittance" (
    "id" TEXT NOT NULL,
    "subscriptionTransactionId" TEXT NOT NULL,
    "status" "AgentCommissionPaymentStatus" NOT NULL DEFAULT 'PAID',
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "reportFileName" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCommissionRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCommissionRemittance_subscriptionTransactionId_key" ON "AgentCommissionRemittance"("subscriptionTransactionId");

-- CreateIndex
CREATE INDEX "AgentCommissionRemittance_status_updatedAt_idx" ON "AgentCommissionRemittance"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentCommissionRemittance_paidByUserId_idx" ON "AgentCommissionRemittance"("paidByUserId");

-- AddForeignKey
ALTER TABLE "AgentCommissionRemittance" ADD CONSTRAINT "AgentCommissionRemittance_subscriptionTransactionId_fkey" FOREIGN KEY ("subscriptionTransactionId") REFERENCES "SubscriptionTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommissionRemittance" ADD CONSTRAINT "AgentCommissionRemittance_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
