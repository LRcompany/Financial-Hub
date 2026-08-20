import { prisma } from "../prisma.js";

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
