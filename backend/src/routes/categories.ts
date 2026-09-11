import { Router } from "express";
import { prisma } from "../prisma.js";

export const categoriesRouter = Router();

const VALID_TYPES = ["income", "expense"];
const VALID_KINDS = ["essential", "non_essential", "investment"];

// GET /api/categories — retorna a árvore completa (mãe > filho > neto, os 3
// níveis usados hoje). Antes só trazia 1 nível de `children` — bastava pro
// resto do app (que sempre navega por categoria-folha via outros endpoints),
// mas escondia os netos na tela de gerenciamento em Configurações.
categoriesRouter.get("/categories", async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    include: { children: { include: { children: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  res.json(categories);
});

// POST /api/categories — cria categoria-mãe (sem parentId) ou subcategoria
// (com parentId). Uma subcategoria herda o `type` da mãe (não faz sentido
// misturar receita/despesa na mesma árvore) — por isso `type` só é
// obrigatório quando não tem parentId; com parentId ele é ignorado se vier
// divergente. `kind` só importa pra despesa (ver comentário no schema).
categoriesRouter.post("/categories", async (req, res) => {
  const { name, type, kind, parentId } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nome é obrigatório" });
  }

  let resolvedType: string;
  let depth = 1;

  if (parentId) {
    // Precisa subir 2 níveis (não só 1) pra saber a profundidade real do pai
    // — um bug real pego em teste manual: checar só `parent.parentId` marca
    // filho (profundidade 2) e neto (profundidade 3) como a mesma coisa
    // ("tem pai" nos dois casos), deixando criar um bisneto por engano.
    const parent = await prisma.category.findUnique({ where: { id: parentId }, include: { parent: { include: { parent: true } } } });
    if (!parent) return res.status(404).json({ error: "Categoria-mãe não encontrada" });
    const parentDepth = parent.parent ? (parent.parent.parentId ? 3 : 2) : 1;
    depth = parentDepth + 1;
    if (depth > 3) {
      return res.status(400).json({ error: "Essa categoria já é um neto — a árvore vai só até 3 níveis (mãe > filho > neto)." });
    }
    resolvedType = parent.type;
  } else {
    if (typeof type !== "string" || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: "type precisa ser 'income' ou 'expense'" });
    }
    resolvedType = type;
  }

  const resolvedKind = resolvedType === "expense" ? (VALID_KINDS.includes(kind) ? kind : "non_essential") : "non_essential";

  const category = await prisma.category.create({
    data: { name: name.trim(), type: resolvedType, kind: resolvedKind, parentId: parentId || null },
  });
  res.status(201).json(category);
});

// PUT /api/categories/:id — só renomeia e/ou muda o kind. Não mexe em
// type/parentId por aqui (reorganizar a árvore é um passo manual à parte,
// mais arriscado — fora do escopo do que foi pedido: "editar, remover e
// adicionar categoria nova").
categoriesRouter.put("/categories/:id", async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) return res.status(404).json({ error: "Categoria não encontrada" });

  const { name, kind } = req.body ?? {};
  const data: { name?: string; kind?: string } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Nome não pode ser vazio" });
    data.name = name.trim();
  }
  if (kind !== undefined) {
    if (!VALID_KINDS.includes(kind)) return res.status(400).json({ error: "kind inválido" });
    data.kind = kind;
  }

  const updated = await prisma.category.update({ where: { id: category.id }, data });
  res.json(updated);
});

// DELETE /api/categories/:id — nunca deleta em cascata. Recusa (409) se tiver
// subcategoria (precisa apagar/mover os filhos primeiro) ou qualquer dado
// real referenciando essa categoria (Transaction, BudgetTarget,
// UpcomingInstallment, CategorizationRule) — mesmo padrão de proteção usado
// pra corretora (ver DELETE /brokers/:id): "nada de valores fakes" também
// significa nunca apagar histórico real sem avisar.
categoriesRouter.delete("/categories/:id", async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) return res.status(404).json({ error: "Categoria não encontrada" });

  const childrenCount = await prisma.category.count({ where: { parentId: category.id } });
  if (childrenCount > 0) {
    return res.status(409).json({
      error: `"${category.name}" tem ${childrenCount} subcategoria${childrenCount === 1 ? "" : "s"} — apague ou mova elas primeiro.`,
      childrenCount,
    });
  }

  const [transactionCount, budgetTargetCount, installmentCount, ruleCount] = await Promise.all([
    prisma.transaction.count({ where: { categoryId: category.id } }),
    prisma.budgetTarget.count({ where: { categoryId: category.id } }),
    prisma.upcomingInstallment.count({ where: { categoryId: category.id } }),
    prisma.categorizationRule.count({ where: { categoryId: category.id } }),
  ]);
  const total = transactionCount + budgetTargetCount + installmentCount + ruleCount;
  if (total > 0) {
    return res.status(409).json({
      error: `"${category.name}" tem dado real gravado (${transactionCount} transações, ${budgetTargetCount} metas, ${installmentCount} parcelas, ${ruleCount} regras) — apagar perderia esse histórico.`,
      transactionCount,
      budgetTargetCount,
      installmentCount,
      ruleCount,
    });
  }

  await prisma.category.delete({ where: { id: category.id } });
  res.json({ deleted: true });
});
