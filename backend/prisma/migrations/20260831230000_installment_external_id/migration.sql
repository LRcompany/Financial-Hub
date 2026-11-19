-- Coluna nova, nullable, com índice único (permite muitos NULL em SQLite —
-- só valores não-nulos precisam ser distintos entre si).
ALTER TABLE "UpcomingInstallment" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "UpcomingInstallment_externalId_key" ON "UpcomingInstallment"("externalId");
