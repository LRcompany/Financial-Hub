/*
  Warnings:

  - You are about to drop the column `annualReturnAssumptionPct` on the `WealthGoal` table. All the data in the column will be lost.
  - You are about to drop the column `monthlySavingsTarget` on the `WealthGoal` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "WealthGoalYearly" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "savingsTarget" REAL NOT NULL,
    "annualReturnAssumptionPct" REAL NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WealthGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetAmount" REAL NOT NULL
);
INSERT INTO "new_WealthGoal" ("id", "targetAmount") SELECT "id", "targetAmount" FROM "WealthGoal";
DROP TABLE "WealthGoal";
ALTER TABLE "new_WealthGoal" RENAME TO "WealthGoal";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WealthGoalYearly_year_key" ON "WealthGoalYearly"("year");
