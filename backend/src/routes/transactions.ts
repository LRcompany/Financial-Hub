import { Router } from "express";
import { prisma } from "../prisma.js";

export const transactionsRouter = Router();

// GET /api/transactions?month=8&year=2026
transactionsRouter.get("/transactions", async (req, res) => {
  const { month, year } = req.query;

  const where: Record<string, unknown> = {};
  if (month && year) {
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end = new Date(Number(year), Number(month), 1);
    where.date = { gte: start, lt: end };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, broker: true },
    orderBy: { date: "desc" },
  });

  res.json(transactions);
});

// GET /api/transactions/uncategorized-groups — transação real (Transaction,
// já aconteceu — diferente de UpcomingInstallment) sem categoria, agrupada
// por comerciante (mesma descrição exata = mesmo comerciante, categoriza
// tudo de uma vez, mesmo com valor diferente por compra — Uber de R$14 e de
// R$22 são a mesma categoria de qualquer forma). Existe pra alimentar o
// "status bar" de compra sem categoria + o modal de revisão.
transactionsRouter.get("/transactions/uncategorized-groups", async (_req, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { categoryId: null, type: "expense", isTransfer: false },
    orderBy: { date: "desc" },
  });

  const groups = new Map<string, { description: string; totalAmount: number; ids: string[]; lastDate: Date }>();
  for (const t of transactions) {
    const existing = groups.get(t.description);
    if (existing) {
      existing.ids.push(t.id);
      existing.totalAmount += t.amount;
      if (t.date > existing.lastDate) existing.lastDate = t.date;
    } else {
      groups.set(t.description, { description: t.description, totalAmount: t.amount, ids: [t.id], lastDate: t.date });
    }
  }

  const result = [...groups.values()]
    .map((g) => ({ description: g.description, count: g.ids.length, totalAmount: g.totalAmount, lastDate: g.lastDate, ids: g.ids }))
    .sort((a, b) => b.lastDate.getTime() - a.lastDate.getTime());

  const leafCategories = await prisma.category.findMany({
    where: { type: "expense", kind: { not: "investment" }, children: { none: {} } },
    include: { parent: { include: { parent: true } } },
    orderBy: { name: "asc" },
  });
  const categories = leafCategories
    .map((c) => ({ id: c.id, path: [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean).join(" > ") }))
    .sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));

  res.json({ total: transactions.length, groups: result, categories });
});

// PUT /api/transactions/group — body { ids, categoryId }. Aplica em TODAS as
// transações daquele comerciante de uma vez (mesma lógica de grupo já usada
// em /upcoming-installments/group).
transactionsRouter.put("/transactions/group", async (req, res) => {
  const { ids, categoryId } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids precisa ser uma lista não vazia" });
  }
  if (!categoryId) {
    return res.status(400).json({ error: "categoryId é obrigatório" });
  }
  const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { children: true } });
  if (!category) return res.status(404).json({ error: "Categoria não encontrada" });
  if (category.children.length > 0) {
    return res.status(400).json({ error: "Essa categoria é uma categoria-mãe — escolha uma subcategoria (folha)" });
  }
  const result = await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
  res.json({ updated: result.count });
});

// POST /api/transactions — lançamento manual avulso
transactionsRouter.post("/transactions", async (req, res) => {
  const { date, type, description, amount, categoryId } = req.body;

  if (!date || !type || !description || amount == null) {
    return res.status(400).json({ error: "Campos obrigatórios: date, type, description, amount" });
  }

  const transaction = await prisma.transaction.create({
    data: {
      date: new Date(date),
      type,
      description,
      amount,
      categoryId: categoryId ?? null,
      source: "manual",
    },
  });

  res.status(201).json(transaction);
});
