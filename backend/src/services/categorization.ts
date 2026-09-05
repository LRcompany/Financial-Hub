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

/**
 * Sugere uma categoria a partir da descrição de uma transação importada,
 * usando as CategorizationRule já cadastradas (pré-populadas com o padrão
 * real da planilha do Luiz — ver docs/blueprint.md).
 */
export async function suggestCategory(description: string) {
  const rules = await prisma.categorizationRule.findMany({
    orderBy: { confidence: "desc" },
    include: { category: true },
  });

  const normalized = description.toLowerCase();
  const match = rules.find((rule) => normalized.includes(rule.pattern.toLowerCase()));

  return match?.category ?? null;
}

/** Chamado quando o usuário confirma (ou corrige) a categoria sugerida — reforça a regra. */
export async function reinforceRule(pattern: string, categoryId: string) {
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
