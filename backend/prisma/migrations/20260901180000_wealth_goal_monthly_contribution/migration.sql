-- Substitui a tabela ano-a-ano (retorno chutado) por um aporte mensal único
-- + retorno calculado de verdade a partir do histórico real.
ALTER TABLE "WealthGoal" ADD COLUMN "monthlyContribution" REAL NOT NULL DEFAULT 0;
DROP TABLE "WealthGoalYearly";
