-- Add structured location fields for tenant onboarding.
ALTER TABLE "Tenant"
ADD COLUMN "country" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "lga" TEXT;
