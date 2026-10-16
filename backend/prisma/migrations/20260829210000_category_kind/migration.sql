-- Substitui `essential` (booleano, só 2 estados) por `kind` (essential |
-- non_essential | investment) — SQLite não suporta ALTER COLUMN de tipo,
-- recria a tabela.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'non_essential',
    "usage" TEXT,
    "parentId" TEXT,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Category" ("id", "name", "type", "kind", "usage", "parentId")
SELECT "id", "name", "type", CASE WHEN "essential" = 1 THEN 'essential' ELSE 'non_essential' END, "usage", "parentId"
FROM "Category";

DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_name_parentId_key" ON "Category"("name", "parentId");

PRAGMA foreign_keys=ON;
