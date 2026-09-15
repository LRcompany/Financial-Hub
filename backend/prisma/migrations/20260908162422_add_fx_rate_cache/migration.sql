-- CreateTable
CREATE TABLE "FxRateCache" (
    "pair" TEXT NOT NULL PRIMARY KEY,
    "rate" REAL NOT NULL,
    "fetchedAt" DATETIME NOT NULL
);
