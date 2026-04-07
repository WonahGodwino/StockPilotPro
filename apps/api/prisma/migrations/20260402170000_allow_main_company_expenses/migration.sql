-- Allow tenant-level (main company) expenses without a subsidiary.
ALTER TABLE "Expense"
ALTER COLUMN "subsidiaryId" DROP NOT NULL;
