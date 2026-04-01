-- Add idempotency reference for offline sync on sales and expenses
ALTER TABLE "Sale" ADD COLUMN "syncRef" TEXT;
ALTER TABLE "Expense" ADD COLUMN "syncRef" TEXT;

-- Enforce one synced record per tenant + sync reference
CREATE UNIQUE INDEX "Sale_tenantId_syncRef_key" ON "Sale"("tenantId", "syncRef");
CREATE UNIQUE INDEX "Expense_tenantId_syncRef_key" ON "Expense"("tenantId", "syncRef");
