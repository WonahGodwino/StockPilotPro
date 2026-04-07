-- CreateEnum
CREATE TYPE "EnterpriseAiSignalClass" AS ENUM ('PUBLIC', 'PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "EnterpriseAiRecommendationType" AS ENUM (
  'DEMAND_FORECAST',
  'REORDER_ADVISOR',
  'PRICING_MARGIN_ADVISOR',
  'CASHFLOW_FORECAST',
  'EXPENSE_RISK_ALERT',
  'ANOMALY_DETECTION',
  'BRANCH_PERFORMANCE',
  'NL_ASSISTANT'
);

-- CreateEnum
CREATE TYPE "EnterpriseAiRecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'SNOOZED', 'NOT_RELEVANT', 'RESOLVED');

-- CreateTable
CREATE TABLE "EnterpriseAiFeatureSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "snapshotVersion" TEXT NOT NULL,
    "freshnessScore" DECIMAL(5,2),
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "featureSnapshot" JSONB NOT NULL,
    "sourceCoverage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnterpriseAiFeatureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAiSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "signalClass" "EnterpriseAiSignalClass" NOT NULL,
    "source" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "signalValue" JSONB NOT NULL,
    "tags" JSONB DEFAULT '[]',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnterpriseAiSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAiRecommendation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subsidiaryId" TEXT,
    "recommendationType" "EnterpriseAiRecommendationType" NOT NULL,
    "status" "EnterpriseAiRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidenceScore" DECIMAL(5,4),
    "riskScore" DECIMAL(5,4),
    "reasonCodes" JSONB DEFAULT '[]',
    "sourceProvenance" JSONB DEFAULT '[]',
    "modelVersion" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "outputPayload" JSONB NOT NULL,
    "actedByUserId" TEXT,
    "actedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "feedbackNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseAiRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAiRecommendationDecision" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnterpriseAiRecommendationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAiMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "metricKey" TEXT NOT NULL,
    "metricValue" DECIMAL(18,6) NOT NULL,
    "dimensions" JSONB DEFAULT '{}',
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnterpriseAiMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnterpriseAiFeatureSnapshot_tenantId_generatedAt_idx" ON "EnterpriseAiFeatureSnapshot"("tenantId", "generatedAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiSignal_tenantId_effectiveDate_idx" ON "EnterpriseAiSignal"("tenantId", "effectiveDate");

-- CreateIndex
CREATE INDEX "EnterpriseAiSignal_signalClass_effectiveDate_idx" ON "EnterpriseAiSignal"("signalClass", "effectiveDate");

-- CreateIndex
CREATE INDEX "EnterpriseAiSignal_signalKey_effectiveDate_idx" ON "EnterpriseAiSignal"("signalKey", "effectiveDate");

-- CreateIndex
CREATE INDEX "EnterpriseAiRecommendation_tenantId_createdAt_idx" ON "EnterpriseAiRecommendation"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiRecommendation_tenantId_status_createdAt_idx" ON "EnterpriseAiRecommendation"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiRecommendation_tenantId_recommendationType_createdAt_idx" ON "EnterpriseAiRecommendation"("tenantId", "recommendationType", "createdAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiRecommendation_subsidiaryId_idx" ON "EnterpriseAiRecommendation"("subsidiaryId");

-- CreateIndex
CREATE INDEX "EnterpriseAiRecommendationDecision_recommendationId_createdAt_idx" ON "EnterpriseAiRecommendationDecision"("recommendationId", "createdAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiRecommendationDecision_tenantId_createdAt_idx" ON "EnterpriseAiRecommendationDecision"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiMetric_tenantId_metricKey_measuredAt_idx" ON "EnterpriseAiMetric"("tenantId", "metricKey", "measuredAt");

-- CreateIndex
CREATE INDEX "EnterpriseAiMetric_metricKey_measuredAt_idx" ON "EnterpriseAiMetric"("metricKey", "measuredAt");
