/*
  Warnings:

  - Added the required column `effectiveFrom` to the `DailySpendGoal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PositionSnapshot" ADD COLUMN "fxRateToBRL" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailySpendGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL
);
INSERT INTO "new_DailySpendGoal" ("amount", "id") SELECT "amount", "id" FROM "DailySpendGoal";
DROP TABLE "DailySpendGoal";
ALTER TABLE "new_DailySpendGoal" RENAME TO "DailySpendGoal";
CREATE TABLE "new_Security" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ticker" TEXT,
    "type" TEXT NOT NULL,
    "sector" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "targetAllocationPct" REAL,
    "targetDividendYield" REAL
);
INSERT INTO "new_Security" ("id", "name", "sector", "targetAllocationPct", "targetDividendYield", "ticker", "type") SELECT "id", "name", "sector", "targetAllocationPct", "targetDividendYield", "ticker", "type" FROM "Security";
DROP TABLE "Security";
ALTER TABLE "new_Security" RENAME TO "Security";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
