-- AlterTable
ALTER TABLE "PositionSnapshot" ADD COLUMN "investedOriginal" REAL;

-- Preenche com o que a tela de atualização já deduzia (investido em R$ ÷
-- cotação da foto), ANTES de qualquer foto ser recotada pelo dólar de
-- fechamento — assim o investido em dólar de cada mês fica exatamente o de hoje.
UPDATE "PositionSnapshot"
SET "investedOriginal" = "investedAmount" / "fxRateToBRL"
WHERE "fxRateToBRL" > 0
  AND "securityId" IN (SELECT "id" FROM "Security" WHERE "currency" IN ('USD', 'EUR'))
  AND "brokerId" IN (SELECT "id" FROM "Broker" WHERE "dataSource" = 'manual_statement');
