-- AlterTable
ALTER TABLE "PositionSnapshot" ADD COLUMN "syncedAt" DATETIME;

-- AlterTable
ALTER TABLE "Security" ADD COLUMN "rate" REAL;
ALTER TABLE "Security" ADD COLUMN "rateType" TEXT;

-- CreateTable
CREATE TABLE "InvestmentMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "quantity" REAL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvestmentMovement_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Broker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvestmentMovement_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentMovement_externalId_key" ON "InvestmentMovement"("externalId");

-- CreateIndex
CREATE INDEX "InvestmentMovement_brokerId_date_idx" ON "InvestmentMovement"("brokerId", "date");

-- CreateIndex
CREATE INDEX "InvestmentMovement_securityId_idx" ON "InvestmentMovement"("securityId");

