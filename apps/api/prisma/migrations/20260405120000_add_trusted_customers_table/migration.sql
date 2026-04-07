-- CreateTable
CREATE TABLE "TrustedCustomer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "TrustedCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustedCustomer_isActive_displayOrder_idx" ON "TrustedCustomer"("isActive", "displayOrder");
