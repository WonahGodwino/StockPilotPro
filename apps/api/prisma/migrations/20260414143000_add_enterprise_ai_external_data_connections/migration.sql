-- CreateTable: EnterpriseAiExternalDataConnection
CREATE TABLE "EnterpriseAiExternalDataConnection" (
    "id"                   TEXT NOT NULL,
    "tenantId"             TEXT NOT NULL,
    "providerType"         TEXT NOT NULL,
    "connectionName"       TEXT,
    "host"                 TEXT NOT NULL,
    "port"                 INTEGER NOT NULL DEFAULT 5432,
    "databaseName"         TEXT NOT NULL,
    "schemaName"           TEXT NOT NULL DEFAULT 'public',
    "sslRequired"          BOOLEAN NOT NULL DEFAULT true,
    "status"               TEXT NOT NULL DEFAULT 'PENDING',
    "validationState"      TEXT NOT NULL DEFAULT 'DRAFT',
    "encryptedCredentials" TEXT NOT NULL,
    "mappingConfig"        JSONB DEFAULT '{}'::jsonb,
    "schemaSnapshot"       JSONB DEFAULT '{}'::jsonb,
    "lastValidatedAt"      TIMESTAMP(3),
    "lastValidationError"  TEXT,
    "lastHealthStatus"     TEXT,
    "lastHealthAt"         TIMESTAMP(3),
    "groundingEnabled"     BOOLEAN NOT NULL DEFAULT false,
    "isActive"             BOOLEAN NOT NULL DEFAULT true,
    "createdBy"            TEXT,
    "updatedBy"            TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseAiExternalDataConnection_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: EnterpriseAiExternalDataConnection.tenantId -> Tenant
ALTER TABLE "EnterpriseAiExternalDataConnection"
    ADD CONSTRAINT "EnterpriseAiExternalDataConnection_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: EnterpriseAiExternalDataConnection
CREATE UNIQUE INDEX "EnterpriseAiExternalDataConnection_tenantId_providerType_key"
    ON "EnterpriseAiExternalDataConnection"("tenantId", "providerType");
CREATE INDEX "EnterpriseAiExternalDataConnection_tenantId_status_idx"
    ON "EnterpriseAiExternalDataConnection"("tenantId", "status");
CREATE INDEX "EnterpriseAiExternalDataConnection_tenantId_groundingEnabled_idx"
    ON "EnterpriseAiExternalDataConnection"("tenantId", "groundingEnabled");
