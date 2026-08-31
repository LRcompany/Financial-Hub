import { Router } from "express";
import { prisma } from "../prisma.js";

export const budgetRouter = Router();

/** Meta vigente numa data: a linha mais recente com effectiveFrom <= date. */
function goalAt(goals: { amount: number; effectiveFrom: Date }[], date: Date): number | null {
  let applicable: { amount: number; effectiveFrom: Date } | null = null;
  for (const g of goals) {
    if (g.effectiveFrom <= date && (!applicable || g.effectiveFrom > applicable.effectiveFrom)) {
      applicable = g;
    }
  }
  return applicable?.amount ?? null;
}

// GET /api/budget-summary?month=8&year=2026
// Orçamento mensal (soma dos BudgetTarget do mês) + gasto real por categoria +
// meta/gasto diário — tudo calculado a partir de Transaction, sem valor fixo.
budgetRouter.get("/budget-summary", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const prevMonthDate = new Date(year, month - 2, 1);
  const prevMonthStart = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1);
  const prevMonthEnd = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 1);

  const [targets, dailyGoals] = await Promise.all([
    // Só categoria de despesa — meta de receita (Salário, projetos) é
    // "quanto espero receber", não "quanto posso gastar", não faz sentido
    // misturar na mesma lista de progresso de gasto por categoria. Também
    // exclui kind "investment" — aporte não é gasto, tem home própria em
    // Patrimônio; deixar aqui inflava o "planejado" do mês com meta de
    // investimento (ex: R$1.323,05 de "Liberdade Financeira" somado ao total
    // de despesa, sem fazer sentido no "quanto gastei este mês").
    prisma.budgetTarget.findMany({
      where: { month, year, category: { type: "expense", kind: { not: "investment" } } },
      include: { category: true },
    }),
    prisma.dailySpendGoal.findMany({ orderBy: { effectiveFrom: "asc" } }),
  ]);

  const categories = await Promise.all(
    targets.map(async (target) => {
      const [spentAgg, previousSpentAgg] = await Promise.all([
        prisma.transaction.aggregate({
          where: {
            categoryId: target.categoryId,
            type: "expense",
            isTransfer: false,
            date: { gte: monthStart, lt: monthEnd },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            categoryId: target.categoryId,
            type: "expense",
            isTransfer: false,
            date: { gte: prevMonthStart, lt: prevMonthEnd },
          },
          _sum: { amount: true },
        }),
      ]);
      return {
        categoryId: target.categoryId,
        name: target.category.name,
        kind: target.category.kind, // essential | non_essential | investment
        planned: target.plannedAmount,
        spent: spentAgg._sum.amount ?? 0,
        previousSpent: previousSpentAgg._sum.amount ?? 0,
      };
    })
  );

  const totalPlanned = categories.reduce((sum, c) => sum + c.planned, 0);
  const totalSpent = categories.reduce((sum, c) => sum + c.spent, 0);

  // Gasto de hoje e série dos últimos 14 dias — todas as despesas do período,
  // não só as categorizadas no orçamento (reflete o gasto real do dia a dia).
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(todayStart.getTime() - 13 * 24 * 60 * 60 * 1000);
  const twentyEightDaysAgo = new Date(todayStart.getTime() - 27 * 24 * 60 * 60 * 1000);

  const [todayAgg, last28Transactions] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: "expense", isTransfer: false, date: { gte: todayStart, lt: todayEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { type: "expense", isTransfer: false, date: { gte: twentyEightDaysAgo, lt: todayEnd } },
      select: { date: true, amount: true },
    }),
  ]);

  const last14Days: { date: string; amount: number; goal: number | null }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(fourteenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const amount = last28Transactions
      .filter((t) => t.date >= day && t.date < dayEnd)
      .reduce((sum, t) => sum + t.amount, 0);
    last14Days.push({ date: day.toISOString().slice(0, 10), amount, goal: goalAt(dailyGoals, day) });
  }
  const previous14Days: number[] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(twentyEightDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const amount = last28Transactions
      .filter((t) => t.date >= day && t.date < dayEnd)
      .reduce((sum, t) => sum + t.amount, 0);
    previous14Days.push(amount);
  }

  const monthlyAvgDailySpend = last14Days.reduce((sum, d) => sum + d.amount, 0) / 14;
  const previousMonthlyAvgDailySpend = previous14Days.reduce((sum, v) => sum + v, 0) / 14;

  res.json({
    month,
    year,
    dailyGoal: goalAt(dailyGoals, now),
    todaySpent: todayAgg._sum.amount ?? 0,
    monthlyAvgDailySpend,
    previousMonthlyAvgDailySpend,
    last14Days,
    totalPlanned,
    totalSpent,
    categories,
  });
});

// GET /api/daily-goal/history — histórico completo, mais recente primeiro
budgetRouter.get("/daily-goal/history", async (_req, res) => {
  const goals = await prisma.dailySpendGoal.findMany({ orderBy: { effectiveFrom: "desc" } });
  res.json(goals);
});

// POST /api/daily-goal — body { amount }. NUNCA atualiza uma linha existente:
// sempre cria uma nova, vigente a partir de hoje — dias passados continuam
// avaliados pela meta que valia neles.
budgetRouter.post("/daily-goal", async (req, res) => {
  const { amount } = req.body ?? {};
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount precisa ser um número positivo" });
  }
  const today = new Date();
  const effectiveFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const goal = await prisma.dailySpendGoal.create({ data: { amount, effectiveFrom } });
  res.status(201).json(goal);
});

// DELETE /api/daily-goal/:id — corrige um lançamento errado (não é o fluxo normal de "mudar a meta")
budgetRouter.delete("/daily-goal/:id", async (req, res) => {
  await prisma.dailySpendGoal.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

// GET /api/upcoming-installments?month&year — parcela de compra parcelada
// que ainda vai vencer (não é gasto que já aconteceu, é compromisso futuro
// conhecido). Responde "quanto ainda tenho comprometido no cartão/parcelado"
// a PARTIR do mês informado (o mesmo que o Luiz está navegando no Orçamento)
// — sem esse filtro a lista nunca diminuiria: parcela de mês já passado
// ficaria contando pra sempre. Avançar mês no Orçamento naturalmente esvazia
// esse card conforme os parcelamentos vão terminando.
budgetRouter.get("/upcoming-installments", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const monthStart = new Date(year, month - 1, 1);

  const installments = await prisma.upcomingInstallment.findMany({
    where: { dueDate: { gte: monthStart } },
    orderBy: { dueDate: "asc" },
    include: { category: true },
  });
  const total = installments.reduce((sum, i) => sum + i.amount, 0);

  const byMonth = new Map<string, number>();
  const byCard = new Map<string, number>();
  for (const i of installments) {
    const key = `${i.dueDate.getFullYear()}-${String(i.dueDate.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + i.amount);
    const cardKey = i.cardLabel ?? "Outros (sem cartão identificado)";
    byCard.set(cardKey, (byCard.get(cardKey) ?? 0) + i.amount);
  }

  res.json({
    total,
    byMonth: [...byMonth.entries()].map(([month, amount]) => ({ month, amount })),
    byCard: [...byCard.entries()].map(([card, amount]) => ({ card, amount })).sort((a, b) => b.amount - a.amount),
    installments: installments.map((i) => ({
      id: i.id,
      dueDate: i.dueDate,
      description: i.description,
      amount: i.amount,
      category: i.category?.name ?? null,
      cardLabel: i.cardLabel,
    })),
  });
});

// A planilha codifica parcela na própria descrição ("bike x3", "bike x4" —
// mesma compra, um sufixo " xN" por linha). A fatura da Caixa não faz isso
// (cada linha da mesma compra futura já vem com a MESMA descrição). Tirar o
// sufixo deixa as duas fontes agrupáveis pela mesma chave.
function purchaseBase(description: string): string {
  return description.replace(/\s+x\d+$/i, "").trim();
}

// GET /api/upcoming-installments/groups — TODAS as parcelas futuras (sem
// filtro de mês — é ferramenta de conferência, não quer esconder nada),
// agrupadas por compra (mesma descrição-base + valor = mesma compra
// parcelada, uma linha por mês restante). Existe pra responder "quais
// compras estão sem cartão configurado, e quais já foram batidas" de forma
// que dê pra corrigir em lote (todas as parcelas da mesma compra de uma vez,
// não uma por uma).
budgetRouter.get("/upcoming-installments/groups", async (_req, res) => {
  const installments = await prisma.upcomingInstallment.findMany({ orderBy: { dueDate: "asc" } });

  const groups = new Map<
    string,
    { description: string; amount: number; cardLabel: string | null; ids: string[]; dueDates: Date[] }
  >();
  for (const i of installments) {
    const key = `${purchaseBase(i.description)}|${i.amount.toFixed(2)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(i.id);
      existing.dueDates.push(i.dueDate);
    } else {
      groups.set(key, { description: purchaseBase(i.description), amount: i.amount, cardLabel: i.cardLabel, ids: [i.id], dueDates: [i.dueDate] });
    }
  }

  const result = [...groups.values()]
    .map((g) => ({
      description: g.description,
      amount: g.amount,
      cardLabel: g.cardLabel,
      count: g.ids.length,
      firstDueDate: g.dueDates.reduce((a, b) => (a < b ? a : b)),
      lastDueDate: g.dueDates.reduce((a, b) => (a > b ? a : b)),
      ids: g.ids,
    }))
    // Sem cartão primeiro (é o que precisa de atenção), depois por descrição.
    .sort((a, b) => {
      if ((a.cardLabel === null) !== (b.cardLabel === null)) return a.cardLabel === null ? -1 : 1;
      return a.description.localeCompare(b.description, "pt-BR");
    });

  const knownCards = [...new Set(installments.map((i) => i.cardLabel).filter((c): c is string => c !== null))].sort();

  res.json({ groups: result, knownCards });
});

// PUT /api/upcoming-installments/group — body { ids, cardLabel?, amount? }.
// Aplica em TODAS as linhas da compra de uma vez (as parcelas restantes dela)
// — é a correção "essa compra inteira é do C6", não uma parcela isolada.
budgetRouter.put("/upcoming-installments/group", async (req, res) => {
  const { ids, cardLabel, amount } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids precisa ser uma lista não vazia" });
  }
  const data: { cardLabel?: string | null; amount?: number } = {};
  if (cardLabel !== undefined) data.cardLabel = cardLabel === "" ? null : cardLabel;
  if (typeof amount === "number" && amount >= 0) data.amount = amount;
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Nada pra atualizar — informe cardLabel e/ou amount" });
  }
  const result = await prisma.upcomingInstallment.updateMany({ where: { id: { in: ids } }, data });
  res.json({ updated: result.count });
});

// DELETE /api/upcoming-installments/group — body { ids }. Pra duplicata
// confirmada (mesma compra já importada de outra fonte) — remove a compra
// inteira (todas as parcelas restantes), não uma linha isolada.
budgetRouter.delete("/upcoming-installments/group", async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids precisa ser uma lista não vazia" });
  }
  const result = await prisma.upcomingInstallment.deleteMany({ where: { id: { in: ids } } });
  res.json({ deleted: result.count });
});

// GET /api/budget-target/review?month=8&year=2026 — todas as categorias de
// despesa com o gasto REAL do mês anterior, pra alimentar o modal de "revisar
// orçamento do mês" (passo a passo, uma categoria por vez, mostrando "você
// gastou X em Terapia mês passado, quer manter esse valor de meta agora?").
// Diferente do /budget-summary: aqui é TODA categoria, mesmo sem meta ainda
// definida pro mês atual (é exatamente o caso de mês novo, sem nada setado).
budgetRouter.get("/budget-target/review", async (req, res) => {
  const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  const prevDate = new Date(year, month - 2, 1);
  const prevMonth = prevDate.getMonth() + 1;
  const prevYear = prevDate.getFullYear();
  const prevStart = new Date(prevYear, prevMonth - 1, 1);
  const prevEnd = new Date(prevYear, prevMonth, 1);

  const [categories, currentTargets] = await Promise.all([
    // Mesmo corte do /budget-summary — investimento não é meta de gasto do
    // Orçamento, não faz sentido revisar aportar aqui. `children: { none: {} }`
    // exclui categoria-mãe (Moradia, Transporte...) — mãe é só rollup pra
    // gráfico geral, meta real sempre é lançada na filha (folha).
    prisma.category.findMany({
      where: { type: "expense", kind: { not: "investment" }, children: { none: {} } },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.budgetTarget.findMany({ where: { month, year } }),
  ]);
  const targetByCategory = new Map(currentTargets.map((t) => [t.categoryId, t.plannedAmount]));

  const result = await Promise.all(
    categories.map(async (c) => {
      const agg = await prisma.transaction.aggregate({
        where: { categoryId: c.id, type: "expense", isTransfer: false, date: { gte: prevStart, lt: prevEnd } },
        _sum: { amount: true },
      });
      return {
        categoryId: c.id,
        name: c.name,
        kind: c.kind,
        previousSpent: agg._sum.amount ?? 0,
        currentTarget: targetByCategory.get(c.id) ?? null,
      };
    })
  );

  res.json({ categories: result });
});

// PUT /api/budget-target — body { categoryId, month, year, plannedAmount }.
// É o Luiz estipulando "posso gastar X em Mercado esse mês" — upsert porque
// mudar de ideia no meio do mês é o caso normal, não uma correção.
budgetRouter.put("/budget-target", async (req, res) => {
  const { categoryId, month, year, plannedAmount } = req.body ?? {};
  if (!categoryId || !month || !year || typeof plannedAmount !== "number" || plannedAmount < 0) {
    return res.status(400).json({ error: "Campos obrigatórios: categoryId, month, year, plannedAmount (>= 0)" });
  }
  const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { children: true } });
  if (!category) return res.status(404).json({ error: "Categoria não encontrada" });
  // Mãe é só rollup pra gráfico geral — meta real sempre na filha (folha).
  if (category.children.length > 0) {
    return res.status(400).json({ error: "Essa categoria é uma categoria-mãe — defina a meta na subcategoria, não nela" });
  }

  const target = await prisma.budgetTarget.upsert({
    where: { categoryId_month_year: { categoryId, month, year } },
    update: { plannedAmount },
    create: { categoryId, month, year, plannedAmount },
  });
  res.json(target);
});

// POST /api/budget-target/copy-from-previous-month — body { month, year }.
// Duplica as metas do mês anterior pro mês informado, só pras categorias que
// ainda não têm meta lá (nunca sobrescreve o que ele já ajustou manualmente
// nesse mês) — atalho pro "todo mês é basicamente o mesmo orçamento de novo".
budgetRouter.post("/budget-target/copy-from-previous-month", async (req, res) => {
  const { month, year } = req.body ?? {};
  if (!month || !year) return res.status(400).json({ error: "Campos obrigatórios: month, year" });

  const prevDate = new Date(year, month - 2, 1);
  const prevMonth = prevDate.getMonth() + 1;
  const prevYear = prevDate.getFullYear();

  const [prevTargets, existingTargets] = await Promise.all([
    prisma.budgetTarget.findMany({ where: { month: prevMonth, year: prevYear } }),
    prisma.budgetTarget.findMany({ where: { month, year }, select: { categoryId: true } }),
  ]);
  const already = new Set(existingTargets.map((t) => t.categoryId));

  const toCreate = prevTargets.filter((t) => !already.has(t.categoryId));
  await prisma.budgetTarget.createMany({
    data: toCreate.map((t) => ({ categoryId: t.categoryId, month, year, plannedAmount: t.plannedAmount })),
  });
  res.status(201).json({ copied: toCreate.length, skippedExisting: prevTargets.length - toCreate.length });
});
