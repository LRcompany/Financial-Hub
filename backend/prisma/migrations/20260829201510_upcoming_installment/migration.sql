-- CreateTable
CREATE TABLE "UpcomingInstallment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dueDate" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "categoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpcomingInstallment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UpcomingInstallment_dueDate_idx" ON "UpcomingInstallment"("dueDate");
