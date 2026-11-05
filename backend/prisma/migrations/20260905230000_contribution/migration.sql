-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "amountBRL" REAL NOT NULL,
    "fxRateToBRL" REAL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contribution_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Broker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Contribution_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Contribution_securityId_idx" ON "Contribution"("securityId");

-- CreateIndex
CREATE INDEX "Contribution_brokerId_idx" ON "Contribution"("brokerId");
