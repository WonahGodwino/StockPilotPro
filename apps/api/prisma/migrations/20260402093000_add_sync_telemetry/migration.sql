-- CreateTable
CREATE TABLE "SyncTelemetry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subsidiaryId" TEXT,
    "userId" TEXT,
    "deviceId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "status" TEXT NOT NULL,
    "pendingBefore" INTEGER NOT NULL DEFAULT 0,
    "syncedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncTelemetry_tenantId_createdAt_idx" ON "SyncTelemetry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncTelemetry_tenantId_deviceId_createdAt_idx" ON "SyncTelemetry"("tenantId", "deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncTelemetry_tenantId_status_createdAt_idx" ON "SyncTelemetry"("tenantId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncTelemetry" ADD CONSTRAINT "SyncTelemetry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncTelemetry" ADD CONSTRAINT "SyncTelemetry_subsidiaryId_fkey" FOREIGN KEY ("subsidiaryId") REFERENCES "Subsidiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncTelemetry" ADD CONSTRAINT "SyncTelemetry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
