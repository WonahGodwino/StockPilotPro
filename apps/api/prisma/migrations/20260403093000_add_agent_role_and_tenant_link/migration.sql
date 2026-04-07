ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AGENT';

ALTER TABLE "Tenant"
ADD COLUMN IF NOT EXISTS "acquisitionAgentId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Tenant_acquisitionAgentId_fkey'
  ) THEN
    ALTER TABLE "Tenant"
    ADD CONSTRAINT "Tenant_acquisitionAgentId_fkey"
    FOREIGN KEY ("acquisitionAgentId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Tenant_acquisitionAgentId_idx" ON "Tenant"("acquisitionAgentId");
