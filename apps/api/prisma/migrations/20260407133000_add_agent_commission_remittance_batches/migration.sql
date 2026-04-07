-- AlterTable
ALTER TABLE "AgentCommissionRemittance"
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "cycleStartAt" TIMESTAMP(3),
ADD COLUMN     "cycleEndAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AgentCommissionRemittance_batchId_idx" ON "AgentCommissionRemittance"("batchId");

-- CreateIndex
CREATE INDEX "AgentCommissionRemittance_cycleStartAt_cycleEndAt_idx" ON "AgentCommissionRemittance"("cycleStartAt", "cycleEndAt");
