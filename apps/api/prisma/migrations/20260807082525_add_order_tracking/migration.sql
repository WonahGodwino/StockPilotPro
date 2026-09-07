/*
  Warnings:

  - A unique constraint covering the columns `[trackingCode]` on the table `Sale` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TrackingStatus" AS ENUM ('PENDING', 'PAYMENT_VALIDATED', 'GOODS_PACKED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "trackingCode" TEXT,
ADD COLUMN     "trackingStatus" "TrackingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedByUserId" TEXT,
ADD COLUMN     "validationNote" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_trackingCode_key" ON "Sale"("trackingCode");
