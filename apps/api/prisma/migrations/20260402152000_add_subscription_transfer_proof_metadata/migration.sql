ALTER TABLE "SubscriptionTransaction"
  ADD COLUMN "transferProofOriginalName" TEXT,
  ADD COLUMN "transferProofSize" INTEGER,
  ADD COLUMN "transferProofContentType" TEXT,
  ADD COLUMN "transferProofUploadedByUserId" TEXT,
  ADD COLUMN "transferProofUploadedAt" TIMESTAMP(3);

ALTER TABLE "SubscriptionTransaction"
  ADD CONSTRAINT "SubscriptionTransaction_transferProofUploadedByUserId_fkey"
  FOREIGN KEY ("transferProofUploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SubscriptionTransaction_transferProofUploadedByUserId_idx"
  ON "SubscriptionTransaction"("transferProofUploadedByUserId");
