-- Conector MCP (25/11): data da última alteração (vazia nas linhas antigas —
-- não se sabe quando mudaram) e histórico de sincronização.
-- AlterTable
ALTER TABLE "PositionSnapshot" ADD COLUMN "updatedAt" DATETIME;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "updatedAt" DATETIME;

-- AlterTable
ALTER TABLE "ProjectReceipt" ADD COLUMN "updatedAt" DATETIME;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "updatedAt" DATETIME;

-- AlterTable
ALTER TABLE "UpcomingInstallment" ADD COLUMN "updatedAt" DATETIME;

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "brokerName" TEXT,
    "trigger" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "summary" TEXT,
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

