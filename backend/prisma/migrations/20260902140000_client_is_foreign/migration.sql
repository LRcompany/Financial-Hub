-- Cliente estrangeiro tem DAS variável (só sabido no boleto real) — cliente
-- nacional continua com o fixo 6% já assumido antes.
ALTER TABLE "Client" ADD COLUMN "isForeign" BOOLEAN NOT NULL DEFAULT false;
