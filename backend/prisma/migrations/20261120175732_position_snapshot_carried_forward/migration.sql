-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PositionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "investedAmount" REAL NOT NULL,
    "marketValue" REAL NOT NULL,
    "fxRateToBRL" REAL,
    "dividends" REAL,
    "monthlyRatePct" REAL,
    "annualRatePct" REAL,
    "quantity" REAL,
    "unitValue" REAL,
    "syncedAt" DATETIME,
    "carriedForward" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PositionSnapshot_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Broker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PositionSnapshot_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PositionSnapshot" ("annualRatePct", "brokerId", "dividends", "fxRateToBRL", "id", "investedAmount", "marketValue", "month", "monthlyRatePct", "quantity", "securityId", "syncedAt", "unitValue", "year") SELECT "annualRatePct", "brokerId", "dividends", "fxRateToBRL", "id", "investedAmount", "marketValue", "month", "monthlyRatePct", "quantity", "securityId", "syncedAt", "unitValue", "year" FROM "PositionSnapshot";
DROP TABLE "PositionSnapshot";
ALTER TABLE "new_PositionSnapshot" RENAME TO "PositionSnapshot";
CREATE UNIQUE INDEX "PositionSnapshot_brokerId_securityId_month_year_key" ON "PositionSnapshot"("brokerId", "securityId", "month", "year");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

