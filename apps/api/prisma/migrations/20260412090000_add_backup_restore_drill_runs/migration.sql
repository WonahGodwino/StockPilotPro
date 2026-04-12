CREATE TABLE "BackupRestoreDrillRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'MANUAL',
    "dbConnectivityOk" BOOLEAN NOT NULL DEFAULT false,
    "backupVerificationOk" BOOLEAN NOT NULL DEFAULT false,
    "restoreDrillOk" BOOLEAN NOT NULL DEFAULT false,
    "backupArtifactPath" TEXT,
    "backupArtifactMtime" TIMESTAMP(3),
    "backupArtifactAgeHours" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "checkPayload" JSONB,
    "initiatedByUserId" TEXT,
    "initiatedByTenantId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackupRestoreDrillRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupRestoreDrillRun_startedAt_idx" ON "BackupRestoreDrillRun"("startedAt");
CREATE INDEX "BackupRestoreDrillRun_status_idx" ON "BackupRestoreDrillRun"("status");
