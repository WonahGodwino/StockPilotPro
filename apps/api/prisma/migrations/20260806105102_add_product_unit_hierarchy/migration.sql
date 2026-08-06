-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_subsidiaryId_fkey";

-- DropIndex
DROP INDEX "Product_category_idx";

-- DropIndex
DROP INDEX "SubscriptionTransaction_transferProofUploadedByUserId_idx";

-- CreateIndex
CREATE INDEX "ProductBrand_tenantId_idx" ON "ProductBrand"("tenantId");

-- CreateIndex
CREATE INDEX "ProductCategory_tenantId_idx" ON "ProductCategory"("tenantId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_subsidiaryId_fkey" FOREIGN KEY ("subsidiaryId") REFERENCES "Subsidiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "EnterpriseAiExternalDataConnection_tenantId_groundingEnabled_id" RENAME TO "EnterpriseAiExternalDataConnection_tenantId_groundingEnable_idx";

-- RenameIndex
ALTER INDEX "EnterpriseAiRecommendation_tenantId_recommendationType_createdA" RENAME TO "EnterpriseAiRecommendation_tenantId_recommendationType_crea_idx";

-- RenameIndex
ALTER INDEX "EnterpriseAiRecommendationDecision_recommendationId_createdAt_i" RENAME TO "EnterpriseAiRecommendationDecision_recommendationId_created_idx";
