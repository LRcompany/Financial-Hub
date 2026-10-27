import { Router } from "express";
import { prisma } from "../prisma.js";
import { reinforceRule, categoryPath } from "../services/categorization.js";
import { expenseLedger, sumByCategory, ledgerTotal, purchaseBase, buildInstallmentPositions, type LedgerItem } from "../services/ledger.js";

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

// Categoria-mãe direta e avó (até 3 níveis: Transporte > Carro > Aluguel) —
// o front agrupa por essa mãe.
function parentInfo(c: { parent: { id: string; name: string; parent: { id: string; name: string } | null } | null } | null) {
  const parent = c?.parent ?? null;
  return { parentId: parent?.parent?.id ?? parent?.id ?? null, parentName: parent?.parent?.name ?? parent?.name ?? null };
}

export const UNCATEGORIZED_ID = "uncategorized";

// GET /api/budget-summary?month=8&year=2026
// Orçamento do mês + gasto por categoria + gasto diário. TODO gasto vem do
// livro-razão (`services/ledger.ts`, 27/10) — o mesmo número em toda tela.
// Desde 27/10 o total inclui gasto em categoria SEM meta (`hasTarget:
// false`) e SEM categoria (linha "Sem categoria") — antes ficavam de fora do
// total do Orçamento mas dentro do gráfico diário (set/26: R$24.483,99 x
// R$24.782,37 pro mesmo mês).
budgetRouter.get("/budget-summary", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const prevMonthStart = new Date(year, month - 2, 1);
  const prevMonthEnd = monthStart;

  const [targets, dailyGoals, ledgerMonth, ledgerPrev, expenseCategories] = await Promise.all([
    // Meta de investimento não é meta de gasto (aporte tem home em Patrimônio).
    prisma.budgetTarget.findMany({ where: { month, year, category: { type: "expense", kind: { not: "investment" } } } }),
    prisma.dailySpendGoal.findMany({ orderBy: { effectiveFrom: "asc" } }),
    expenseLedger(monthStart, monthEnd),
    expenseLedger(prevMonthStart, prevMonthEnd),
    prisma.category.findMany({ where: { type: "expense" }, include: { parent: { include: { parent: true } } } }),
  ]);
  const catById = new Map(expenseCategories.map((c) => [c.id, c]));
  const spentNow = sumByCategory(ledgerMonth);
  const spentPrev = sumByCategory(ledgerPrev);
  const plannedById = new Map(targets.map((t) => [t.categoryId, t.plannedAmount]));

  // Linhas: toda categoria com meta + toda categoria com gasto (com ou sem meta) + "Sem categoria".
  const ids = new Set<string | null>([...plannedById.keys(), ...spentNow.keys()]);
  const categories = [...ids]
    .map((id) => {
      const now = spentNow.get(id) ?? { spent: 0, installments: 0 };
      const prev = spentPrev.get(id)?.spent ?? 0;
      if (id === null) {
        return {
          categoryId: UNCATEGORIZED_ID,
          name: "Sem categoria",
          kind: "uncategorized",
          parentId: null,
          parentName: null,
          hasTarget: false,
          planned: 0,
          spent: now.spent,
          spentProjected: now.installments,
          previousSpent: prev,
        };
      }
      const cat = catById.get(id);
      if (!cat || cat.kind === "investment") return null;
      return {
        categoryId: id,
        name: cat.name,
        kind: cat.kind, // essential | non_essential
        ...parentInfo(cat),
        hasTarget: plannedById.has(id),
        planned: plannedById.get(id) ?? 0,
        spent: now.spent,
        spentProjected: now.installments,
        previousSpent: prev,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const totalPlanned = categories.reduce((sum, c) => sum + c.planned, 0);
  const totalSpent = ledgerTotal(ledgerMonth);
  const totalProjected = ledgerMonth.filter((i) => i.kind === "installment").reduce((s, i) => s + i.amount, 0);

  // Entradas do mês (recebimentos de projeto viram Transaction de entrada).
  const [incomeAgg, previousIncomeAgg, incomeFromProjectsAgg] = await Promise.all([
    prisma.transaction.aggregate({ where: { type: "income", isTransfer: false, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: "income", isTransfer: false, date: { gte: prevMonthStart, lt: prevMonthEnd } }, _sum: { amount: true } }),
    prisma.transaction.aggregate({
      where: { type: "income", isTransfer: false, projectReceiptId: { not: null }, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
  ]);
  const totalIncome = incomeAgg._sum.amount ?? 0;
  const previousTotalIncome = previousIncomeAgg._sum.amount ?? 0;
  const incomeFromProjects = incomeFromProjectsAgg._sum.amount ?? 0;

  // Maior compra do mês (relatório mensal): o maior gasto real, inteiro (uma
  // transação dividida conta pelo valor total, não por fatia).
  const byTransaction = new Map<string, { amount: number; item: LedgerItem }>();
  for (const i of ledgerMonth) {
    if (i.kind !== "posted" || !i.transactionId) continue;
    const cur = byTransaction.get(i.transactionId);
    byTransaction.set(i.transactionId, { amount: (cur?.amount ?? 0) + i.amount, item: cur?.item ?? i });
  }
  const biggest = [...byTransaction.values()].sort((a, b) => b.amount - a.amount)[0];
  const biggestPurchase = biggest
    ? {
        description: biggest.item.description,
        amount: biggest.amount,
        date: biggest.item.date,
        category: biggest.item.category,
        installmentNumber: biggest.item.installmentNumber,
        totalInstallments: biggest.item.totalInstallments,
      }
    : null;

  // Entradas por mês, últimos 12 (gráfico "Por mês" do box Entradas).
  const twelveMonthsAgoStart = new Date(year, month - 12, 1);
  const incomeHistoryTransactions = await prisma.transaction.findMany({
    where: { type: "income", isTransfer: false, date: { gte: twelveMonthsAgoStart, lt: monthEnd } },
    select: { date: true, amount: true },
  });
  const incomeByMonth: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const bucketStart = new Date(year, month - 1 - i, 1);
    const bucketEnd = new Date(year, month - i, 1);
    const value = incomeHistoryTransactions.filter((t) => t.date >= bucketStart && t.date < bucketEnd).reduce((sum, t) => sum + t.amount, 0);
    incomeByMonth.push({ label: bucketStart.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }), value });
  }

  // Gasto diário do MÊS NAVEGADO (02/10): mês atual = dia 1 até hoje (dia
  // futuro não é "abaixo" nem "acima" de nada); mês passado = inteiro; mês
  // futuro = vazio. Mesmo livro-razão do total acima.
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const isCurrentMonth = monthStart <= now && now < monthEnd;
  const windowEnd = monthEnd < todayEnd ? monthEnd : todayEnd;
  const DAY = 24 * 60 * 60 * 1000;
  const onDay = (items: LedgerItem[], day: Date) => items.filter((i) => i.date >= day && i.date.getTime() < day.getTime() + DAY);

  const dailyDays: { date: string; amount: number; projected: number; goal: number | null; breakdown: { label: string; value: number; projected: boolean }[] }[] = [];
  for (let day = new Date(monthStart); day < windowEnd; day.setDate(day.getDate() + 1)) {
    const items = onDay(ledgerMonth, day);
    const groups = new Map<string, { value: number; projected: boolean }>();
    for (const i of items) {
      const cur = groups.get(i.label);
      groups.set(i.label, { value: (cur?.value ?? 0) + i.amount, projected: cur ? cur.projected && i.kind === "installment" : i.kind === "installment" });
    }
    dailyDays.push({
      date: day.toISOString().slice(0, 10),
      amount: ledgerTotal(items),
      projected: items.filter((i) => i.kind === "installment").reduce((s, i) => s + i.amount, 0),
      goal: goalAt(dailyGoals, day),
      breakdown: [...groups.entries()].map(([label, v]) => ({ label, value: v.value, projected: v.projected })).sort((a, b) => b.value - a.value),
    });
  }
  // "vs. mês anterior": mesmo NÚMERO de dias (dia 1 ao dia 1...), não o mês inteiro.
  const previousMonthAligned: number[] = [];
  for (let i = 0; i < dailyDays.length; i++) {
    const day = new Date(prevMonthStart);
    day.setDate(day.getDate() + i);
    if (day >= prevMonthEnd) break;
    previousMonthAligned.push(ledgerTotal(onDay(ledgerPrev, day)));
  }
  const monthlyAvgDailySpend = dailyDays.length > 0 ? dailyDays.reduce((sum, d) => sum + d.amount, 0) / dailyDays.length : 0;
  const previousMonthlyAvgDailySpend =
    previousMonthAligned.length > 0 ? previousMonthAligned.reduce((sum, v) => sum + v, 0) / previousMonthAligned.length : 0;

  // Último dia da janela com gasto (a Pluggy atrasa — "hoje" quase sempre R$0).
  let lastDayWithSpend: { date: string; amount: number } | null = null;
  for (let i = dailyDays.length - 1; i >= 0; i--) {
    if (dailyDays[i].amount > 0) {
      lastDayWithSpend = { date: dailyDays[i].date, amount: dailyDays[i].amount };
      break;
    }
  }
  let daysUnderGoal = 0;
  let daysWithGoal = 0;
  for (const d of dailyDays) {
    if (d.goal == null) continue;
    daysWithGoal++;
    if (d.amount <= d.goal) daysUnderGoal++;
  }
  // Meta vigente no fim da janela (hoje, ou o último dia de um mês passado).
  const dailyGoal = goalAt(dailyGoals, new Date(windowEnd.getTime() - 1));

  res.json({
    month,
    year,
    isCurrentMonth,
    dailyGoal,
    lastDayWithSpend,
    monthlyAvgDailySpend,
    previousMonthlyAvgDailySpend,
    daysUnderGoal,
    daysWithGoal,
    dailyDays,
    totalPlanned,
    totalSpent,
    // Total do mês anterior inteiro, pelo mesmo livro-razão — somar o
    // `previousSpent` das linhas perdia categoria que só teve gasto lá.
    previousTotalSpent: ledgerTotal(ledgerPrev),
    totalProjected,
    totalIncome,
    previousTotalIncome,
    incomeFromProjects,
    incomeByMonth,
    categories,
    biggestPurchase,
  });
});

// GET /api/budget-summary/category-breakdown?month&year&categoryIds=a,b,c
// "O que está incluso nesse montante" (10/09) — os itens do livro-razão das
// categorias clicadas (`uncategorized` = sem categoria). O total da modal é
// por construção o mesmo da linha clicada.
budgetRouter.get("/budget-summary/category-breakdown", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const ids = new Set(
    String(req.query.categoryIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (ids.size === 0) return res.json({ transactions: [], projected: [] });
  const items = (await expenseLedger(new Date(year, month - 1, 1), new Date(year, month, 1))).filter((i) =>
    i.categoryId === null ? ids.has(UNCATEGORIZED_ID) : ids.has(i.categoryId)
  );
  const row = (i: LedgerItem) => ({
    id: i.id,
    date: i.date,
    description: i.description,
    rawDescription: i.rawDescription,
    amount: i.amount,
    category: i.category,
    installmentNumber: i.installmentNumber,
    totalInstallments: i.totalInstallments,
  });
  res.json({
    transactions: items.filter((i) => i.kind === "posted").map(row).sort((a, b) => b.date.getTime() - a.date.getTime()),
    projected: items.filter((i) => i.kind === "installment").map(row),
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

// `externalId` de parcela vinda do sync real da Pluggy já carrega a própria
// posição no formato "pluggy:<id da transação original>:<parcela N>" (ver
// pluggyTransactionSync.ts). Isso dá "parcela N" de graça, sem precisar de
// coluna nova — e o TOTAL de parcelas também dá pra descobrir sem nada novo:
// o sync sempre cria uma linha pra CADA parcela restante até a última (nunca
// para no meio), então o maior N já visto pra aquela transação-mãe É o
// total (mesmo que parcelas antigas já vencidas continuem no banco — elas
// nunca são apagadas, só as futuras somem da lista por causa do filtro de
// mês). Null pra parcela importada da planilha (sem esse formato de id).
// GET /api/upcoming-installments?month&year — parcela de compra parcelada
// que ainda vai vencer (não é gasto que já aconteceu, é compromisso futuro
// conhecido). A lista/total/byCard são do MÊS informado (o mesmo que o Luiz
// está navegando no Orçamento, por padrão) — só esse mês, não acumulado com
// todo mês futuro (04/09: "quero ver só desse mês... em outubro, só
// outubro"). `byMonth` já é diferente: cobre TODO mês futuro com parcela
// pendente (sem filtro), pro carrossel "Por mês" no front deixar clicar em
// outubro/novembro/... e ver o compromisso daquele mês sem precisar navegar
// a página inteira (pedido explícito, 04/09: "deixa o carousel lá... se eu
// clicar em outubro vou ver o que foi parcelado em outubro").
budgetRouter.get("/upcoming-installments", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Parcela é parcela (02/10): toda parcela do mês, lançada pela Pluggy ou
  // ainda não — tirada do MESMO livro-razão do Orçamento (27/10), então o
  // total daqui e a fatia de parcelas no Orçamento nunca divergem.
  const isInstallment = (i: LedgerItem) => i.kind === "installment" || (i.totalInstallments ?? 0) > 1;
  const [ledgerMonth, ledgerAhead, allUpcoming] = await Promise.all([
    expenseLedger(monthStart, monthEnd),
    expenseLedger(currentMonthStart, new Date(now.getFullYear(), now.getMonth() + 36, 1)),
    prisma.upcomingInstallment.findMany({ select: { dueDate: true, description: true, amount: true } }),
  ]);
  const items = ledgerMonth.filter(isInstallment);
  const total = items.reduce((sum, i) => sum + i.amount, 0);

  const byCard = new Map<string, number>();
  for (const i of items) {
    const cardKey = i.cardLabel ?? "Outros (sem cartão identificado)";
    byCard.set(cardKey, (byCard.get(cardKey) ?? 0) + i.amount);
  }

  const byMonthMap = new Map<string, { month: number; year: number; amount: number }>();
  for (const i of ledgerAhead.filter(isInstallment)) {
    const key = `${i.date.getFullYear()}-${i.date.getMonth() + 1}`;
    const cur = byMonthMap.get(key) ?? { month: i.date.getMonth() + 1, year: i.date.getFullYear(), amount: 0 };
    cur.amount += i.amount;
    byMonthMap.set(key, cur);
  }
  const byMonth = [...byMonthMap.values()].sort((a, b) => a.year - b.year || a.month - b.month);

  // "Terminam neste mês" (24/09): a última parcela da compra. Com "N de
  // Total", é N === Total; parcela manual sem total conhecido termina quando
  // não existe parcela da mesma compra (descrição + valor) mais pra frente.
  const lastDueByPurchase = new Map<string, number>();
  for (const r of allUpcoming) {
    const key = `${purchaseBase(r.description)}|${r.amount.toFixed(2)}`;
    lastDueByPurchase.set(key, Math.max(lastDueByPurchase.get(key) ?? 0, r.dueDate.getTime()));
  }
  const isLast = (i: LedgerItem) =>
    i.totalInstallments != null && i.installmentNumber != null
      ? i.installmentNumber === i.totalInstallments
      : i.kind === "installment" && lastDueByPurchase.get(`${i.label}|${i.amount.toFixed(2)}`) === i.date.getTime();
  const ending = items.filter(isLast).sort((a, b) => b.amount - a.amount);

  const toRow = (i: LedgerItem) => ({
    id: i.id,
    dueDate: i.date,
    description: i.rawDescription ?? i.description,
    note: i.rawDescription ? i.description : null,
    amount: i.amount,
    category: i.category,
    cardLabel: i.cardLabel,
    installmentNumber: i.installmentNumber,
    totalInstallments: i.totalInstallments,
  });

  res.json({
    total,
    ending: ending.map(toRow),
    endingTotal: ending.reduce((sum, i) => sum + i.amount, 0),
    byCard: [...byCard.entries()].map(([card, amount]) => ({ card, amount })).sort((a, b) => b.amount - a.amount),
    byMonth,
    installments: items.map(toRow),
  });
});

// GET /api/upcoming-installments/groups — TODAS as parcelas futuras (sem
// filtro de mês — é ferramenta de conferência, não quer esconder nada),
// agrupadas por compra (mesma descrição-base + valor = mesma compra
// parcelada, uma linha por mês restante). Existe pra responder "quais
// compras estão sem cartão configurado, e quais já foram batidas" de forma
// que dê pra corrigir em lote (todas as parcelas da mesma compra de uma vez,
// não uma por uma).
budgetRouter.get("/upcoming-installments/groups", async (_req, res) => {
  const installments = await prisma.upcomingInstallment.findMany({
    orderBy: { dueDate: "asc" },
    include: { category: { include: { parent: { include: { parent: true } } } } },
  });

  const positions = buildInstallmentPositions(installments);

  // Parcela(s) da MESMA compra que já aconteceu de verdade (Transaction, não
  // UpcomingInstallment) — pedido do Luiz (08/09: "precisa aparecer na lista
  // das compras parceladas em orçamento"). Sem isso, a compra some da "já
  // paguei 1 de 6" — só mostrava as 5 restantes, como se a primeira nunca
  // tivesse existido. Mesma chave de agrupamento (purchaseBase + valor) já
  // usada pra tudo aqui.
  const paidTransactions = await prisma.transaction.findMany({
    where: { totalInstallments: { not: null } },
    select: { description: true, amount: true },
  });
  const paidCountByKey = new Map<string, number>();
  for (const t of paidTransactions) {
    const key = `${purchaseBase(t.description)}|${t.amount.toFixed(2)}`;
    paidCountByKey.set(key, (paidCountByKey.get(key) ?? 0) + 1);
  }

  const groups = new Map<
    string,
    {
      description: string;
      note: string | null;
      amount: number;
      cardLabel: string | null;
      categoryId: string | null;
      categoryPath: string | null;
      ids: string[];
      dueDates: Date[];
      totalInstallments: number | null;
      paidCount: number;
    }
  >();
  for (const i of installments) {
    const key = `${purchaseBase(i.description)}|${i.amount.toFixed(2)}`;
    const groupCategoryPath = categoryPath(i.category);
    // Todas as linhas da mesma compra resolvem pro mesmo total (override
    // manual é sempre aplicado em bloco pra compra inteira) — a 1ª linha já
    // resolvida basta.
    const totalInstallments = positions.get(i.id)?.totalInstallments ?? null;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(i.id);
      existing.dueDates.push(i.dueDate);
    } else {
      groups.set(key, {
        description: purchaseBase(i.description),
        note: i.note,
        amount: i.amount,
        cardLabel: i.cardLabel,
        categoryId: i.categoryId,
        categoryPath: groupCategoryPath,
        ids: [i.id],
        dueDates: [i.dueDate],
        totalInstallments,
        paidCount: paidCountByKey.get(key) ?? 0,
      });
    }
  }

  const result = [...groups.values()]
    .map((g) => ({
      description: g.description,
      note: g.note,
      amount: g.amount,
      cardLabel: g.cardLabel,
      categoryId: g.categoryId,
      categoryPath: g.categoryPath,
      count: g.ids.length,
      paidCount: g.paidCount,
      firstDueDate: g.dueDates.reduce((a, b) => (a < b ? a : b)),
      lastDueDate: g.dueDates.reduce((a, b) => (a > b ? a : b)),
      totalInstallments: g.totalInstallments,
      ids: g.ids,
    }))
    // Sem categoria primeiro (é o que precisa de atenção), depois por descrição.
    .sort((a, b) => {
      if ((a.categoryId === null) !== (b.categoryId === null)) return a.categoryId === null ? -1 : 1;
      return a.description.localeCompare(b.description, "pt-BR");
    });

  const knownCards = [...new Set(installments.map((i) => i.cardLabel).filter((c): c is string => c !== null))].sort();

  // Só categoria-folha entra no dropdown — meta/gasto real nunca no pai.
  const leafCategories = await prisma.category.findMany({
    where: { type: "expense", children: { none: {} } },
    include: { parent: { include: { parent: true } } },
    orderBy: { name: "asc" },
  });
  const categories = leafCategories
    .map((c) => ({
      id: c.id,
      path: categoryPath(c) ?? c.name,
    }))
    .sort((a, b) => a.path.localeCompare(b.path, "pt-BR"));

  res.json({ groups: result, knownCards, categories });
});

// PUT /api/upcoming-installments/group — body { ids, cardLabel?, amount?, categoryId?, note?, totalInstallments? }.
// Aplica em TODAS as linhas da compra de uma vez (as parcelas restantes dela)
// — é a correção "essa compra inteira é do C6" ou "essa compra é Farmácia",
// não uma parcela isolada. `totalInstallments` é o override manual (campo
// "Parcela" da modal "Revisar parcelas") pra quando o cálculo automático
// (deriva do externalId da Pluggy) erra ou não existe (parcela de planilha).
// `null`/string vazia LIMPA o override e volta a usar o automático.
budgetRouter.put("/upcoming-installments/group", async (req, res) => {
  const { ids, cardLabel, amount, categoryId, note, totalInstallments } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids precisa ser uma lista não vazia" });
  }
  const data: { cardLabel?: string | null; amount?: number; categoryId?: string | null; note?: string | null; totalInstallments?: number | null } = {};
  if (cardLabel !== undefined) data.cardLabel = cardLabel === "" ? null : cardLabel;
  if (typeof amount === "number" && amount >= 0) data.amount = amount;
  if (note !== undefined) data.note = note === "" ? null : note;
  if (totalInstallments !== undefined) {
    if (totalInstallments === null || totalInstallments === "") {
      data.totalInstallments = null;
    } else if (typeof totalInstallments === "number" && Number.isInteger(totalInstallments) && totalInstallments > 0) {
      data.totalInstallments = totalInstallments;
    } else {
      return res.status(400).json({ error: "totalInstallments precisa ser um número inteiro positivo (ou null pra limpar)" });
    }
  }
  if (categoryId !== undefined) {
    if (categoryId === "" || categoryId === null) {
      data.categoryId = null;
    } else {
      // Só aceita categoria-folha — meta/gasto real nunca deveria estar
      // "solto" numa categoria-mãe (mesma regra do PUT /budget-target).
      const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { children: true } });
      if (!category) return res.status(404).json({ error: "Categoria não encontrada" });
      if (category.children.length > 0) {
        return res.status(400).json({ error: "Essa categoria é uma categoria-mãe — escolha uma subcategoria (folha)" });
      }
      data.categoryId = categoryId;

      // Mesmo reforço de regra do PUT /transactions/group — usa a descrição
      // crua da compra (a que a Pluggy manda, tipo "AMAZONMKTPLC HEIMONLTD"),
      // que é o mesmo texto usado em `suggestCategory` na hora do sync.
      const sample = await prisma.upcomingInstallment.findUnique({ where: { id: ids[0] }, select: { description: true } });
      if (sample) await reinforceRule(sample.description, categoryId);
    }
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Nada pra atualizar — informe cardLabel, amount, categoryId e/ou note" });
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
  const curStart = new Date(year, month - 1, 1);
  const curEnd = new Date(year, month, 1);

  // Mesmo livro-razão do Orçamento (27/10): o "mês passado" da revisão é
  // exatamente o gasto que o Orçamento mostrou naquele mês, e "parcelas em
  // aberto" é a fatia de parcelas (lançadas ou não) deste mês.
  const isInstallment = (i: LedgerItem) => i.kind === "installment" || (i.totalInstallments ?? 0) > 1;
  const [categories, currentTargets, ledgerPrev, ledgerCur] = await Promise.all([
    // Investimento não é meta de gasto; categoria-mãe é só agrupamento (meta
    // sempre na folha).
    prisma.category.findMany({
      where: { type: "expense", kind: { not: "investment" }, children: { none: {} } },
      include: { parent: { include: { parent: true } } },
    }),
    prisma.budgetTarget.findMany({ where: { month, year } }),
    expenseLedger(prevStart, prevEnd),
    expenseLedger(curStart, curEnd),
  ]);
  const targetByCategory = new Map(currentTargets.map((t) => [t.categoryId, t.plannedAmount]));
  const prevByCat = sumByCategory(ledgerPrev);
  const instPrevByCat = sumByCategory(ledgerPrev.filter(isInstallment));
  const instCurByCat = sumByCategory(ledgerCur.filter(isInstallment));

  const result = categories.map((c) => ({
    categoryId: c.id,
    name: c.name,
    // Caminho completo — várias folhas repetem nome entre mães diferentes.
    path: categoryPath(c) ?? c.name,
    kind: c.kind,
    previousSpent: prevByCat.get(c.id)?.spent ?? 0,
    // Parcela em aberto (01/10): a meta deste mês vem preenchida só com as
    // parcelas que vencem neste mês — o único gasto garantido.
    previousInstallments: instPrevByCat.get(c.id)?.spent ?? 0,
    currentInstallments: instCurByCat.get(c.id)?.spent ?? 0,
    currentTarget: targetByCategory.get(c.id) ?? null,
  }));
  // Ordena pelo caminho completo (não só pelo nome da folha) — assim as
  // categorias do mesmo pai ficam juntas, mais fácil de escanear a lista.
  result.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.path.localeCompare(b.path, "pt-BR");
  });

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
