-- Add missing AI cognitive/autonomous tables without resetting data.

CREATE TABLE IF NOT EXISTS "AnonymousLearning" (
    "id" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "region" TEXT,
    "metricKey" TEXT NOT NULL,
    "metricValue" JSONB NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnonymousLearning_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecommendationOutcome" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recommendationType" TEXT NOT NULL,
    "predictedImpact" DOUBLE PRECISION NOT NULL,
    "actualImpact" DOUBLE PRECISION NOT NULL,
    "deviation" DOUBLE PRECISION NOT NULL,
    "successScore" DOUBLE PRECISION NOT NULL,
    "userFeedback" INTEGER,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BusinessTypeMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "primaryType" TEXT NOT NULL,
    "secondaryTypes" JSONB DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedBy" TEXT,
    CONSTRAINT "BusinessTypeMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutonomousRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "maxAutoAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "AutonomousRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutonomousExecution" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "triggerData" JSONB NOT NULL,
    "actionTaken" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutonomousExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnonymousLearning_businessType_insightType_idx"
ON "AnonymousLearning"("businessType", "insightType");

CREATE INDEX IF NOT EXISTS "AnonymousLearning_validFrom_validTo_idx"
ON "AnonymousLearning"("validFrom", "validTo");

CREATE UNIQUE INDEX IF NOT EXISTS "AnonymousLearning_insightType_businessType_metricKey_key"
ON "AnonymousLearning"("insightType", "businessType", "metricKey");

CREATE INDEX IF NOT EXISTS "RecommendationOutcome_recommendationType_successScore_idx"
ON "RecommendationOutcome"("recommendationType", "successScore");

CREATE INDEX IF NOT EXISTS "RecommendationOutcome_tenantId_createdAt_idx"
ON "RecommendationOutcome"("tenantId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessTypeMapping_tenantId_key"
ON "BusinessTypeMapping"("tenantId");

CREATE INDEX IF NOT EXISTS "BusinessTypeMapping_primaryType_idx"
ON "BusinessTypeMapping"("primaryType");

CREATE INDEX IF NOT EXISTS "AutonomousExecution_tenantId_status_idx"
ON "AutonomousExecution"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "AutonomousExecution_ruleId_executedAt_idx"
ON "AutonomousExecution"("ruleId", "executedAt");
