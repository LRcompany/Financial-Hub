-- AlterTable
ALTER TABLE "FxRateCache" ADD COLUMN "source" TEXT;

-- Fechamentos já guardados (set e out/26) vieram da AwesomeAPI.
UPDATE "FxRateCache" SET "source" = 'awesomeapi' WHERE "pair" LIKE '%@%';
