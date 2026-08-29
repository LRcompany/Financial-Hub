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
    // misturar na mesma lista de progresso de gasto por categoria.
    prisma.budgetTarget.findMany({ where: { month, year, category: { type: "expense" } }, include: { category: true } }),
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
        essential: target.category.essential,
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

// GET /api/upcoming-installments — parcela de compra parcelada que ainda vai
// vencer (não é gasto que já aconteceu, é compromisso futuro conhecido).
// Responde "quanto ainda tenho comprometido no cartão/parcelado".
budgetRouter.get("/upcoming-installments", async (_req, res) => {
  const installments = await prisma.upcomingInstallment.findMany({
    orderBy: { dueDate: "asc" },
    include: { category: true },
  });
  const total = installments.reduce((sum, i) => sum + i.amount, 0);

  const byMonth = new Map<string, number>();
  for (const i of installments) {
    const key = `${i.dueDate.getFullYear()}-${String(i.dueDate.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + i.amount);
  }

  res.json({
    total,
    byMonth: [...byMonth.entries()].map(([month, amount]) => ({ month, amount })),
    installments: installments.map((i) => ({
      id: i.id,
      dueDate: i.dueDate,
      description: i.description,
      amount: i.amount,
      category: i.category?.name ?? null,
    })),
  });
});

// PUT /api/budget-target — body { categoryId, month, year, plannedAmount }.
// É o Luiz estipulando "posso gastar X em Mercado esse mês" — upsert porque
// mudar de ideia no meio do mês é o caso normal, não uma correção.
budgetRouter.put("/budget-target", async (req, res) => {
  const { categoryId, month, year, plannedAmount } = req.body ?? {};
  if (!categoryId || !month || !year || typeof plannedAmount !== "number" || plannedAmount < 0) {
    return res.status(400).json({ error: "Campos obrigatórios: categoryId, month, year, plannedAmount (>= 0)" });
  }
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return res.status(404).json({ error: "Categoria não encontrada" });

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
