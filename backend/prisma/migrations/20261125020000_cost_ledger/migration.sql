-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" REAL,
    "unitCost" REAL,
    "amount" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" DATETIME,
    "revertedReason" TEXT,
    CONSTRAINT "CostEntry_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Broker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CostEntry_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CostEntry_securityId_date_idx" ON "CostEntry"("securityId", "date");

