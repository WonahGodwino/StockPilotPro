-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "transactionRef" TEXT;
ALTER TABLE "Expense" ADD COLUMN "transactionRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_tenantId_transactionRef_key" ON "Sale"("tenantId", "transactionRef");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_transactionRef_key" ON "Expense"("tenantId", "transactionRef");
