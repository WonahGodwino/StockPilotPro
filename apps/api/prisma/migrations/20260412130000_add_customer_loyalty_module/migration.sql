-- CreateTable: Customer (loyalty / repeat-buyer module)
CREATE TABLE "Customer" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "phone"          TEXT,
    "email"          TEXT,
    "address"        TEXT,
    "notes"          TEXT,
    "loyaltyPoints"  INTEGER NOT NULL DEFAULT 0,
    "totalSpend"     DECIMAL(14,2) NOT NULL DEFAULT 0,
    "visitCount"     INTEGER NOT NULL DEFAULT 0,
    "lastVisitedAt"  TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "createdBy"      TEXT,
    "updatedBy"      TEXT,
    "archived"       BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LoyaltyLedger
CREATE TABLE "LoyaltyLedger" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "saleId"          TEXT,
    "type"            TEXT NOT NULL,
    "points"          INTEGER NOT NULL,
    "balanceBefore"   INTEGER NOT NULL,
    "balanceAfter"    INTEGER NOT NULL,
    "note"            TEXT,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- Add optional customerId to Sale
ALTER TABLE "Sale" ADD COLUMN "customerId" TEXT;

-- AddForeignKey: Sale.customerId -> Customer
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Customer.tenantId -> Tenant
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: LoyaltyLedger.customerId -> Customer
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: Customer
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX "Customer_tenantId_phone_idx" ON "Customer"("tenantId", "phone");
CREATE INDEX "Customer_tenantId_email_idx" ON "Customer"("tenantId", "email");
CREATE INDEX "Customer_tenantId_loyaltyPoints_idx" ON "Customer"("tenantId", "loyaltyPoints");

-- CreateIndex: Sale.customerId
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex: LoyaltyLedger
CREATE INDEX "LoyaltyLedger_customerId_idx" ON "LoyaltyLedger"("customerId");
CREATE INDEX "LoyaltyLedger_tenantId_customerId_idx" ON "LoyaltyLedger"("tenantId", "customerId");
CREATE INDEX "LoyaltyLedger_saleId_idx" ON "LoyaltyLedger"("saleId");
