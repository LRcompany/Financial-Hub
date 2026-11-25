-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardLabel" TEXT,
    "description" TEXT NOT NULL,
    "installmentAmount" REAL NOT NULL,
    "totalInstallments" INTEGER,
    "categoryId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Purchase_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthTotal" (
    "ym" TEXT NOT NULL PRIMARY KEY,
    "total" REAL NOT NULL,
    "byCategory" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "pluggyPending" BOOLEAN NOT NULL DEFAULT false,
    "awaitingPluggyMatch" BOOLEAN NOT NULL DEFAULT false,
    "installmentNumber" INTEGER,
    "totalInstallments" INTEGER,
    "purchaseId" TEXT,
    "note" TEXT,
    "categoryId" TEXT,
    "recurrenceId" TEXT,
    "brokerId" TEXT,
    "taxPaymentId" TEXT,
    "projectReceiptId" TEXT,
    "supplierPaymentId" TEXT,
    "loanReceivableId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "Recurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "Broker" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_taxPaymentId_fkey" FOREIGN KEY ("taxPaymentId") REFERENCES "TaxPayment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_projectReceiptId_fkey" FOREIGN KEY ("projectReceiptId") REFERENCES "ProjectReceipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_loanReceivableId_fkey" FOREIGN KEY ("loanReceivableId") REFERENCES "LoanReceivable" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("amount", "awaitingPluggyMatch", "brokerId", "categoryId", "createdAt", "date", "description", "externalId", "id", "installmentNumber", "isTransfer", "loanReceivableId", "note", "pluggyPending", "projectReceiptId", "recurrenceId", "source", "supplierPaymentId", "taxPaymentId", "totalInstallments", "type") SELECT "amount", "awaitingPluggyMatch", "brokerId", "categoryId", "createdAt", "date", "description", "externalId", "id", "installmentNumber", "isTransfer", "loanReceivableId", "note", "pluggyPending", "projectReceiptId", "recurrenceId", "source", "supplierPaymentId", "taxPaymentId", "totalInstallments", "type" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");
CREATE TABLE "new_UpcomingInstallment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dueDate" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "amount" REAL NOT NULL,
    "cardLabel" TEXT,
    "externalId" TEXT,
    "totalInstallments" INTEGER,
    "categoryId" TEXT,
    "purchaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpcomingInstallment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UpcomingInstallment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_UpcomingInstallment" ("amount", "cardLabel", "categoryId", "createdAt", "description", "dueDate", "externalId", "id", "note", "totalInstallments") SELECT "amount", "cardLabel", "categoryId", "createdAt", "description", "dueDate", "externalId", "id", "note", "totalInstallments" FROM "UpcomingInstallment";
DROP TABLE "UpcomingInstallment";
ALTER TABLE "new_UpcomingInstallment" RENAME TO "UpcomingInstallment";
CREATE UNIQUE INDEX "UpcomingInstallment_externalId_key" ON "UpcomingInstallment"("externalId");
CREATE INDEX "UpcomingInstallment_dueDate_idx" ON "UpcomingInstallment"("dueDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
