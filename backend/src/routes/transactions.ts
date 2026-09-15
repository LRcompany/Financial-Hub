import { Router } from "express";
import { prisma } from "../prisma.js";
import { reinforceRule, categoryPath, leafExpenseCategories } from "../services/categorization.js";

export const transactionsRouter = Router();

// Luiz decidiu (01/09) não voltar categorizando o passado inteiro — 72
// transações antigas sem categoria ficariam pendentes pra sempre e isso não
// ia acontecer. A partir de hoje sim, categoria vira algo que se cobra de
// verdade. Transação mais antiga que essa data e sem categoria fica de fora
// da contagem/aviso pra sempre (nunca é apagada, só para de aparecer no
// banner e no modal de revisão — o valor dela continua contando nos totais
// de gasto normalmente, só não força categorização retroativa).
const CATEGORIZATION_TRACKING_START = new Date("2026-09-01T00:00:00");

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
    include: {
      category: { include: { parent: { include: { parent: true } } } },
      broker: true,
      // Boleto/fatura dividido em mais de uma categoria (14/09) — ver
      // TransactionSplit no schema. Vazio (`[]`) pra transação normal.
      splits: { include: { category: { include: { parent: { include: { parent: true } } } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { date: "desc" },
  });

  // categoryPath junto do objeto category original (mesmo formato de sempre,
  // pra não quebrar nada que já lê `category.name`/`.kind`) — pedido do Luiz
  // (05/09): mostrar a categoria-mãe junto sempre que mostrar uma categoria.
  res.json(
    transactions.map((t) => ({
      ...t,
      categoryPath: categoryPath(t.category),
      splits: t.splits.map((s) => ({ id: s.id, categoryId: s.categoryId, categoryPath: categoryPath(s.category), amount: s.amount })),
    }))
  );
});

// GET /api/transactions/uncategorized-groups — transação real (Transaction,
// já aconteceu — diferente de UpcomingInstallment) sem categoria, agrupada
// por comerciante (mesma descrição exata = mesmo comerciante, categoriza
// tudo de uma vez, mesmo com valor diferente por compra — Uber de R$14 e de
// R$22 são a mesma categoria de qualquer forma). Existe pra alimentar o
// "status bar" de compra sem categoria + o modal de revisão.
transactionsRouter.get("/transactions/uncategorized-groups", async (_req, res) => {
  const transactions = await prisma.transaction.findMany({
    // `splits: { none: {} }` (14/09) — uma transação dividida em categorias
    // (ver TransactionSplit) já tem categoria de verdade, cada fatia na
    // sua; `categoryId` da Transaction em si continua null pra sempre
    // (nunca é usado depois do split), mas ela não é mais "sem categoria".
    where: { categoryId: null, type: "expense", isTransfer: false, date: { gte: CATEGORIZATION_TRACKING_START }, splits: { none: {} } },
    orderBy: { date: "desc" },
  });

  const groups = new Map<
    string,
    { description: string; totalAmount: number; ids: string[]; lastDate: Date; installmentNumber: number | null; totalInstallments: number | null }
  >();
  for (const t of transactions) {
    const existing = groups.get(t.description);
    if (existing) {
      existing.ids.push(t.id);
      existing.totalAmount += t.amount;
      if (t.date > existing.lastDate) existing.lastDate = t.date;
    } else {
      // installmentNumber/totalInstallments (08/09: "deixa marcado que é
      // uma compra parcelada") vêm da transação mais recente do grupo —
      // uma compra à vista repetida no mesmo comerciante (ex: "Uber") nunca
      // tem esses campos, então não atrapalha o caso comum.
      groups.set(t.description, {
        description: t.description,
        totalAmount: t.amount,
        ids: [t.id],
        lastDate: t.date,
        installmentNumber: t.installmentNumber,
        totalInstallments: t.totalInstallments,
      });
    }
  }

  const result = [...groups.values()]
    .map((g) => ({
      description: g.description,
      count: g.ids.length,
      totalAmount: g.totalAmount,
      lastDate: g.lastDate,
      ids: g.ids,
      installmentNumber: g.installmentNumber,
      totalInstallments: g.totalInstallments,
    }))
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

// PUT /api/transactions/:id/note — body { note }. Puramente documental (08/09,
// "vamos adicionar esse campo apenas para documentar") — pra quando a Pluggy
// manda um nome genérico ("MASTERCARD", "Parcela de compra lojista
// MasterCard") sem jeito de saber o comerciante real. Nunca mexe em
// description/categoria/valor. `note: null`/string vazia limpa a anotação.
transactionsRouter.put("/transactions/:id/note", async (req, res) => {
  const { id } = req.params;
  const { note } = req.body ?? {};
  const trimmed = typeof note === "string" ? note.trim() : null;
  const transaction = await prisma.transaction.update({
    where: { id },
    data: { note: trimmed || null },
  });
  res.json({ id: transaction.id, note: transaction.note });
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

  // Reforça a regra de categorização ANTES de aplicar — assim a próxima
  // compra desse mesmo comerciante (Uber, iFood, etc.) já chega categorizada
  // sozinha no próximo sync, em vez de cair em "sem categoria" de novo.
  const sample = await prisma.transaction.findUnique({ where: { id: ids[0] }, select: { description: true } });
  if (sample) await reinforceRule(sample.description, categoryId);

  const result = await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
  res.json({ updated: result.count });
});

// Tolerância de arredondamento na soma dos splits — ponto flutuante (ex:
// 0.1 + 0.2 !== 0.3) nunca deve travar um split que bate "na prática".
const SPLIT_AMOUNT_TOLERANCE = 0.01;

// PUT /api/transactions/:id/split — body { splits: [{ categoryId, amount }] }.
// Divide um boleto/fatura real (aluguel+água+gás+internet+seguro cobrados
// juntos, por exemplo) em N categorias (14/09, pedido do Luiz). Substitui
// QUALQUER split anterior dessa transação — não incrementa. A soma dos
// valores tem que bater com `Transaction.amount` (o valor real do banco
// nunca muda, só é redistribuído); cada `categoryId` precisa ser uma
// categoria-folha de despesa de verdade, mesma regra de `/transactions/group`.
transactionsRouter.put("/transactions/:id/split", async (req, res) => {
  const { id } = req.params;
  const { splits } = req.body ?? {};

  if (!Array.isArray(splits) || splits.length < 2) {
    return res.status(400).json({ error: "splits precisa ter pelo menos 2 categorias — pra 1 categoria só, use a edição normal." });
  }
  for (const s of splits) {
    if (!s || typeof s.categoryId !== "string" || typeof s.amount !== "number" || s.amount <= 0) {
      return res.status(400).json({ error: "Cada item precisa de categoryId e amount (número positivo)." });
    }
  }

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) return res.status(404).json({ error: "Transação não encontrada." });
  if (transaction.type !== "expense" || transaction.isTransfer) {
    return res.status(400).json({ error: "Só dá pra dividir uma despesa real — transferência/receita não tem categoria." });
  }

  const sum = splits.reduce((s: number, item: { amount: number }) => s + item.amount, 0);
  if (Math.abs(sum - transaction.amount) > SPLIT_AMOUNT_TOLERANCE) {
    return res.status(400).json({
      error: `A soma das categorias (R$ ${sum.toFixed(2)}) precisa bater com o valor da transação (R$ ${transaction.amount.toFixed(2)}).`,
    });
  }

  const categoryIds: string[] = [...new Set(splits.map((s: { categoryId: string }) => s.categoryId))];
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, include: { children: true } });
  if (categories.length !== categoryIds.length) {
    return res.status(404).json({ error: "Categoria não encontrada." });
  }
  const nonLeaf = categories.find((c) => c.children.length > 0);
  if (nonLeaf) {
    return res.status(400).json({ error: `"${nonLeaf.name}" é uma categoria-mãe — escolha uma subcategoria (folha).` });
  }

  await prisma.$transaction([
    prisma.transactionSplit.deleteMany({ where: { transactionId: id } }),
    prisma.transactionSplit.createMany({
      data: splits.map((s: { categoryId: string; amount: number }) => ({ transactionId: id, categoryId: s.categoryId, amount: s.amount })),
    }),
  ]);

  res.status(204).end();
});

// DELETE /api/transactions/:id/split — desfaz a divisão (volta pra categoria
// única normal). A `categoryId` da própria Transaction não muda sozinha —
// o Luiz escolhe de novo pela edição normal se quiser.
transactionsRouter.delete("/transactions/:id/split", async (req, res) => {
  const { id } = req.params;
  await prisma.transactionSplit.deleteMany({ where: { transactionId: id } });
  res.status(204).end();
});

// GET /api/transactions/leaf-categories — categoria-folha de despesa pro
// dropdown do lançamento manual (mesma lista de /uncategorized-groups, só sem
// precisar puxar transação nenhuma pra pedir isso).
transactionsRouter.get("/transactions/leaf-categories", async (_req, res) => {
  res.json(await leafExpenseCategories());
});

// POST /api/transactions — lançamento manual avulso. `brokerId` é opcional
// (pedido do Luiz, 05/09: "deixe um campo pra falar de qual banco veio essa
// transação" — pro caso de banco sem Pluggy, ex: Wise) — não precisa bater
// com um Broker de scope "transactions", qualquer corretora cadastrada serve.
transactionsRouter.post("/transactions", async (req, res) => {
  const { date, type, description, amount, categoryId, brokerId } = req.body ?? {};

  if (!date || !type || !description || amount == null) {
    return res.status(400).json({ error: "Campos obrigatórios: date, type, description, amount" });
  }
  if (type !== "income" && type !== "expense") {
    return res.status(400).json({ error: 'type precisa ser "income" ou "expense"' });
  }

  // "awaitingPluggyMatch" nunca vem do body — é inferido aqui, sempre a
  // partir do banco escolhido (ideia do Luiz, 06/09): lançar assim que a
  // compra acontece, sem esperar o atraso da Pluggy, e deixar o sync de
  // cartão casar com a transação real depois (ver
  // pluggyTransactionSync.ts). Só faz sentido pra corretora que TEM sync
  // automático de cartão — pra corretora manual de verdade (Wise, Nomad)
  // nunca vai chegar nada da Pluggy pra casar, então fica sempre false.
  let awaitingPluggyMatch = false;
  let broker: { dataSource: string; scope: string } | null = null;
  if (brokerId) {
    broker = await prisma.broker.findUnique({ where: { id: brokerId }, select: { dataSource: true, scope: true } });
    if (!broker) return res.status(404).json({ error: "Corretora/banco não encontrado." });
    if (broker.dataSource === "pluggy") {
      const scope: string[] = JSON.parse(broker.scope);
      awaitingPluggyMatch = scope.includes("transactions");
    }
  }

  const transaction = await prisma.transaction.create({
    data: {
      date: new Date(date),
      type,
      description,
      amount,
      categoryId: categoryId ?? null,
      brokerId: brokerId ?? null,
      awaitingPluggyMatch,
      source: "manual",
    },
  });

  res.status(201).json(transaction);
});

// DELETE /api/transactions/:id — só apaga lançamento MANUAL e AINDA NÃO
// CONFIRMADO pelo banco (pedido do Luiz, 14/09: "quando vier do banco, não
// tem como deletar"). Uma transação `source: "pluggy"`/`"ofx_import"`
// precisa continuar batendo com a fatura/extrato real pra sempre — nunca
// pode só sumir da tela. `externalId` preenchido MESMO com `source:
// "manual"` = a reconciliação (pluggyTransactionSync.ts, findAwaitingMatch)
// já casou esse lançamento com a transação real do banco — nesse ponto é
// dinheiro confirmado, não é mais um placeholder (achado 14/09: `source`
// sozinho não muda na reconciliação de propósito, pra nunca sobrescrever a
// categoria que o Luiz escolheu à mão).
transactionsRouter.delete("/transactions/:id", async (req, res) => {
  const { id } = req.params;
  const transaction = await prisma.transaction.findUnique({ where: { id }, select: { source: true, externalId: true } });
  if (!transaction) return res.status(404).json({ error: "Transação não encontrada." });
  if (transaction.source !== "manual" || transaction.externalId != null) {
    return res.status(400).json({ error: "Só é possível apagar um lançamento manual ainda não confirmado pelo banco." });
  }
  await prisma.transaction.delete({ where: { id } });
  res.status(204).end();
});
