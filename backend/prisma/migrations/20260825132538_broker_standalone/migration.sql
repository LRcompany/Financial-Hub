-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Broker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "pluggyConnectorId" TEXT,
    "onchainAddress" TEXT,
    "lastSyncedAt" DATETIME,
    "standalone" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Broker" ("dataSource", "id", "lastSyncedAt", "name", "onchainAddress", "pluggyConnectorId", "scope") SELECT "dataSource", "id", "lastSyncedAt", "name", "onchainAddress", "pluggyConnectorId", "scope" FROM "Broker";
DROP TABLE "Broker";
ALTER TABLE "new_Broker" RENAME TO "Broker";
CREATE UNIQUE INDEX "Broker_name_key" ON "Broker"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
