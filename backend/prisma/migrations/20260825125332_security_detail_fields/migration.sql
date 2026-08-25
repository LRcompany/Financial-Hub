-- AlterTable
ALTER TABLE "Security" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "Security" ADD COLUMN "fixedAnnualRate" REAL;
ALTER TABLE "Security" ADD COLUMN "isin" TEXT;
ALTER TABLE "Security" ADD COLUMN "issuer" TEXT;
ALTER TABLE "Security" ADD COLUMN "ratePeriodicity" TEXT;
