-- Coluna nunca usada em nenhum lugar do código (confirmado por grep antes de
-- remover) — sobrou do modelo antigo de categoria, antes de "kind" existir.
ALTER TABLE "Category" DROP COLUMN "usage";
