import { prisma } from "../prisma.js";

/** Caminho completo até 3 níveis (categoria-mãe > filha > neta) — várias
 * folhas repetem nome entre pais diferentes de propósito (ex: "Aluguel"
 * existe em Moradia E em Transporte > Carro), só o nome da folha sozinho não
 * diz de onde ela veio. Compartilhado entre rotas (budget.ts, transactions.ts
 * — qualquer lugar que mostre categoria de transação/parcela pro Luiz;
 * pedido dele, 05/09: "toda vez que mostrar uma categoria, mostra o pai junto"). */
export function categoryPath(
  c: { name: string; parent?: { name: string; parent?: { name: string } | null } | null } | null | undefined
): string | null {
  if (!c) return null;
  return [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean).join(" > ");
}

/** Lista de categoria-folha de despesa (id + path completo) pro dropdown de
 * lançamento manual — meta/gasto real nunca vai numa categoria-mãe.
 * `kind !== "investment"` porque aporte tem seu próprio fluxo (modal
 * "Registrar aporte" em Patrimônio), não passa por categorização de gasto. */
export async function leafExpenseCategories() {
  const leaves = await prisma.category.findMany({
    where: { type: "expense", kind: { not: "investment" }, children: { none: {} } },
    include: { parent: { include: { parent: true } } },
    orderBy: { name: "asc" },
  });
  return leaves
    .map((c) => ({ id: c.id, path: categoryPath(c) ?? c.name }))
    .sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));
}

// Descrição que NÃO diz quem vendeu (13/11) — o C6 manda compra de alguns
// lojistas só como "Compra a Vista sem Juros MasterCard" / "Parcela de compra
// lojista MasterCard" / "MASTERCARD". Achado real: o app aprendeu uma regra
// com esse texto (uma compra categorizada como Supermercado) e passou a pôr
// TODA compra desse tipo em Supermercado. Texto genérico nunca vira regra,
// nunca recebe sugestão e nunca é agrupado com outro na revisão — cada
// compra é categorizada por si (a nota diz o que foi).
const GENERIC_DESCRIPTIONS = [/^compra a vista sem juros\b/i, /^parcela de compra lojista\b/i, /^mastercard( internacional)?$/i];
export const isGenericDescription = (description: string) => GENERIC_DESCRIPTIONS.some((r) => r.test(description.trim()));

/** A regra vale pra descrição se a descrição CONTÉM o padrão — ou se a
 * descrição é o começo do padrão (19/11): a compra ainda pendente chega com o
 * nome cortado ("UBER UBER *TRIP HELP.U") e a regra foi aprendida com o nome
 * completo de uma já confirmada ("UBER UBER *TRIP HELP.U SAO PAULO BRA"). Só
 * com 10+ letras, pra "UBER" sozinho não casar com qualquer coisa. Espaços
 * repetidos contam como um. */
export function ruleMatches(description: string, pattern: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
  const d = norm(description);
  const p = norm(pattern);
  if (!p) return false;
  return d.includes(p) || (d.length >= 10 && p.startsWith(d));
}

/**
 * Sugere uma categoria a partir da descrição de uma transação importada,
 * usando as CategorizationRule já cadastradas (pré-populadas com o padrão
 * real da planilha do Luiz — ver docs/blueprint.md).
 */
export async function suggestCategory(description: string) {
  if (isGenericDescription(description)) return null;
  const rules = await prisma.categorizationRule.findMany({
    orderBy: { confidence: "desc" },
    include: { category: true },
  });

  const match = rules.find((rule) => !isGenericDescription(rule.pattern) && ruleMatches(description, rule.pattern));

  return match?.category ?? null;
}

/** Chamado quando o usuário confirma (ou corrige) a categoria sugerida — reforça a regra. */
export async function reinforceRule(pattern: string, categoryId: string) {
  if (isGenericDescription(pattern)) return;
  const existing = await prisma.categorizationRule.findFirst({ where: { pattern, categoryId } });

  if (existing) {
    await prisma.categorizationRule.update({
      where: { id: existing.id },
      data: { confidence: Math.min(existing.confidence + 0.05, 1) },
    });
  } else {
    await prisma.categorizationRule.create({
      data: { pattern, categoryId, confidence: 0.5 },
    });
  }
}
