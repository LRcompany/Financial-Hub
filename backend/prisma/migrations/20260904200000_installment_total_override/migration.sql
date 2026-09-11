-- Override manual do total de parcelas de uma compra (corrigível na modal
-- "Revisar parcelas"). Null = usa o cálculo automático (deriva do
-- externalId "pluggy:<txId>:<N>" quando existe).
ALTER TABLE "UpcomingInstallment" ADD COLUMN "totalInstallments" INTEGER;
