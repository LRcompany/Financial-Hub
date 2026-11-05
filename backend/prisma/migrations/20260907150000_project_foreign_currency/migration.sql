-- AlterTable
ALTER TABLE "Project" ADD COLUMN "contractValueForeign" REAL;
ALTER TABLE "Project" ADD COLUMN "currency" TEXT;

-- AlterTable
ALTER TABLE "ProjectReceipt" ADD COLUMN "grossAmountForeign" REAL;
ALTER TABLE "ProjectReceipt" ADD COLUMN "feeAmount" REAL;
ALTER TABLE "ProjectReceipt" ADD COLUMN "iofAmount" REAL;
