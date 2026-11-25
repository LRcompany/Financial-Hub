-- CreateTable
CREATE TABLE "DividendPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brokerId" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    CONSTRAINT "DividendPayment_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Broker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DividendPayment_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DividendPayment_brokerId_securityId_month_year_key" ON "DividendPayment"("brokerId", "securityId", "month", "year");
