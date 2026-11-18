-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "suspended_at" TIMESTAMPTZ,
ADD COLUMN     "suspended_reason" TEXT;
