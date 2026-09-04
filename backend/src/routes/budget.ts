import { Router } from "express";
import { prisma } from "../prisma.js";
import { reinforceRule } from "../services/categorization.js";

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
      include: { category: { include: { parent: { include: { parent: true } } } } },
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
      // Categoria-mãe direta (Moradia) e avó, se a folha estiver 3 níveis
      // fundo (Transporte > Carro > Aluguel) — front agrupa por essa mãe pra
      // exibir em accordion, em vez de listar as ~80 folhas soltas.
      const parent = target.category.parent;
      const parentName = parent?.parent?.name ?? parent?.name ?? null;
      return {
        categoryId: target.categoryId,
        name: target.category.name,
        kind: target.category.kind, // essential | non_essential | investment
        parentId: (parent?.parent?.id ?? parent?.id) ?? null,
        parentName,
        planned: target.plannedAmount,
        spent: spentAgg._sum.amount ?? 0,
        previousSpent: previousSpentAgg._sum.amount ?? 0,
      };
    })
  );

  const totalPlanned = categories.reduce((sum, c) => sum + c.planned, 0);
  const totalSpent = categories.reduce((sum, c) => sum + c.spent, 0);

  // Entradas do mês — Projetos virou o principal gerador de receita real
  // (cada recebimento já cria uma Transaction de entrada), então o Orçamento
  // (visão de dia a dia) precisa mostrar quanto entrou, não só quanto saiu.
  // `incomeFromProjects` é o recorte específico (via projectReceiptId) só
  // pra deixar claro de onde parte da entrada do mês está vindo.
  const [incomeAgg, previousIncomeAgg, incomeFromProjectsAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: "income", isTransfer: false, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "income", isTransfer: false, date: { gte: prevMonthStart, lt: prevMonthEnd } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "income", isTransfer: false, projectReceiptId: { not: null }, date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
  ]);
  const totalIncome = incomeAgg._sum.amount ?? 0;
  const previousTotalIncome = previousIncomeAgg._sum.amount ?? 0;
  const incomeFromProjects = incomeFromProjectsAgg._sum.amount ?? 0;

  // Histórico de entrada por mês (últimos 12, terminando no mês navegado) —
  // pro gráfico "Por mês" dentro do próprio box "Entradas do mês" (pedido do
  // Luiz, 04/09: "quero visualizar isso"). Busca tudo de uma vez (mesmo
  // padrão do last14Days abaixo) e agrupa em memória, em vez de 12 queries.
  const twelveMonthsAgoStart = new Date(year, month - 12, 1);
  const incomeHistoryTransactions = await prisma.transaction.findMany({
    where: { type: "income", isTransfer: false, date: { gte: twelveMonthsAgoStart, lt: monthEnd } },
    select: { date: true, amount: true },
  });
  const incomeByMonth: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const bucketStart = new Date(year, month - 1 - i, 1);
    const bucketEnd = new Date(year, month - i, 1);
    const value = incomeHistoryTransactions
      .filter((t) => t.date >= bucketStart && t.date < bucketEnd)
      .reduce((sum, t) => sum + t.amount, 0);
    incomeByMonth.push({ label: bucketStart.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }), value });
  }

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

  // A Pluggy sincroniza com atraso — "hoje" (e às vezes ontem também) quase
  // sempre aparece com R$0 só porque a transação de verdade ainda não
  // chegou, não porque o dia foi de gasto zero de verdade. Pedido do Luiz
  // (04/09): em vez de mostrar "gasto de hoje" (quase sempre R$0, engana),
  // mostra o ÚLTIMO DIA que realmente tem gasto lançado — varre de trás pra
  // frente dentro dos últimos 14 dias e para no primeiro com amount > 0.
  // `null` só no caso raro de nenhum gasto nos últimos 14 dias inteiros.
  let lastDayWithSpend: { date: string; amount: number } | null = null;
  for (let i = last14Days.length - 1; i >= 0; i--) {
    if (last14Days[i].amount > 0) {
      lastDayWithSpend = { date: last14Days[i].date, amount: last14Days[i].amount };
      break;
    }
  }

  res.json({
    month,
    year,
    dailyGoal: goalAt(dailyGoals, now),
    todaySpent: todayAgg._sum.amount ?? 0,
    lastDayWithSpend,
    monthlyAvgDailySpend,
    previousMonthlyAvgDailySpend,
    last14Days,
    totalPlanned,
    totalSpent,
    totalIncome,
    previousTotalIncome,
    incomeFromProjects,
    incomeByMonth,
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

// `externalId` de parcela vinda do sync real da Pluggy já carrega a própria
// posição no formato "pluggy:<id da transação original>:<parcela N>" (ver
// pluggyTransactionSync.ts). Isso dá "parcela N" de graça, sem precisar de
// coluna nova — e o TOTAL de parcelas também dá pra descobrir sem nada novo:
// o sync sempre cria uma linha pra CADA parcela restante até a última (nunca
// para no meio), então o maior N já visto pra aquela transação-mãe É o
// total (mesmo que parcelas antigas já vencidas continuem no banco — elas
// nunca são apagadas, só as futuras somem da lista por causa do filtro de
// mês). Null pra parcela importada da planilha (sem esse formato de id).
function parsePluggyInstallmentId(externalId: string | null): { purchaseId: string; n: number } | null {
  if (!externalId) return null;
  const match = /^pluggy:(.+):(\d+)$/.exec(externalId);
  if (!match) return null;
  return { purchaseId: match[1], n: Number(match[2]) };
}

/** Maior N visto por compra (`externalId` "pluggy:<txId>:<N>") entre TODA
 * linha passada — é o total derivado automaticamente. `rows` precisa vir
 * sem filtro de mês/data (parcela antiga já vencida conta pro cálculo). */
function buildDerivedTotalsMap(rows: { externalId: string | null }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const parsed = parsePluggyInstallmentId(row.externalId);
    if (!parsed) continue;
    const current = map.get(parsed.purchaseId) ?? 0;
    if (parsed.n > current) map.set(parsed.purchaseId, parsed.n);
  }
  return map;
}

type InstallmentPositionRow = {
  id: string;
  dueDate: Date;
  description: string;
  amount: number;
  externalId: string | null;
  totalInstallments: number | null;
};

/** Calcula "parcela N de Total" pra CADA linha, de um jeito que funciona
 * pra qualquer origem (Pluggy OU Caixa/planilha manual) — não só quando tem
 * `externalId`. A ideia: dentro da mesma compra (mesma `purchaseBase` +
 * valor — mesma chave de agrupamento do endpoint `/groups`), as parcelas
 * restantes são sempre meses CONSECUTIVOS até a última (nunca pula mês no
 * meio), então dá pra contar de trás pra frente a partir do TOTAL: a linha
 * de vencimento mais distante = parcela `total`, a anterior = `total - 1`,
 * e assim por diante. Só precisa saber o TOTAL de algum jeito — manual
 * (`totalInstallments`, corrigido na modal "Revisar parcelas", vale pra
 * QUALQUER cartão) ou automático (maior N do `externalId` "pluggy:<txId>:
 * <N>", só existe pra parcela vinda do sync real da Pluggy). Sem total
 * conhecido (Caixa/planilha sem correção manual ainda), fica tudo null —
 * não dá pra saber a posição sem pelo menos o total. */
function buildInstallmentPositions(rows: InstallmentPositionRow[]): Map<string, { installmentNumber: number | null; totalInstallments: number | null }> {
  const derivedTotals = buildDerivedTotalsMap(rows);

  const groups = new Map<string, InstallmentPositionRow[]>();
  for (const row of rows) {
    const key = `${purchaseBase(row.description)}|${row.amount.toFixed(2)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const result = new Map<string, { installmentNumber: number | null; totalInstallments: number | null }>();
  for (const groupRows of groups.values()) {
    const sorted = [...groupRows].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    // Total: override manual (em qualquer linha do grupo — aplicado em bloco
    // pela modal) sempre vence; senão cai pro automático via externalId.
    let total = sorted.find((r) => r.totalInstallments != null)?.totalInstallments ?? null;
    if (total == null) {
      for (const r of sorted) {
        const parsed = parsePluggyInstallmentId(r.externalId);
        const derived = parsed ? derivedTotals.get(parsed.purchaseId) : undefined;
        if (derived != null) {
          total = derived;
          break;
        }
      }
    }

    const count = sorted.length;
    sorted.forEach((row, index) => {
      const installmentNumber = total != null ? total - count + 1 + index : null;
      result.set(row.id, { installmentNumber, totalInstallments: total });
    });
  }
  return result;
}

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

  const [installments, allFuture, allForPositions] = await Promise.all([
    prisma.upcomingInstallment.findMany({
      where: { dueDate: { gte: monthStart, lt: monthEnd } },
      orderBy: { dueDate: "asc" },
      include: { category: true },
    }),
    prisma.upcomingInstallment.findMany({
      where: { dueDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      select: { dueDate: true, amount: true },
    }),
    // Sem filtro de mês — precisa de TODA parcela já criada da mesma compra
    // (passada ou futura) pra saber o total e a posição de cada uma certos.
    prisma.upcomingInstallment.findMany({
      select: { id: true, dueDate: true, description: true, amount: true, externalId: true, totalInstallments: true },
    }),
  ]);
  const total = installments.reduce((sum, i) => sum + i.amount, 0);

  const byCard = new Map<string, number>();
  for (const i of installments) {
    const cardKey = i.cardLabel ?? "Outros (sem cartão identificado)";
    byCard.set(cardKey, (byCard.get(cardKey) ?? 0) + i.amount);
  }

  const byMonthMap = new Map<string, { month: number; year: number; amount: number }>();
  for (const i of allFuture) {
    const d = new Date(i.dueDate);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const existing = byMonthMap.get(key);
    if (existing) existing.amount += i.amount;
    else byMonthMap.set(key, { month: d.getMonth() + 1, year: d.getFullYear(), amount: i.amount });
  }
  const byMonth = [...byMonthMap.values()].sort((a, b) => a.year - b.year || a.month - b.month);

  const positions = buildInstallmentPositions(allForPositions);

  res.json({
    total,
    byCard: [...byCard.entries()].map(([card, amount]) => ({ card, amount })).sort((a, b) => b.amount - a.amount),
    byMonth,
    installments: installments.map((i) => {
      const position = positions.get(i.id);
      return {
        id: i.id,
        dueDate: i.dueDate,
        description: i.description,
        note: i.note,
        amount: i.amount,
        category: i.category?.name ?? null,
        cardLabel: i.cardLabel,
        installmentNumber: position?.installmentNumber ?? null,
        totalInstallments: position?.totalInstallments ?? null,
      };
    }),
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
  const installments = await prisma.upcomingInstallment.findMany({
    orderBy: { dueDate: "asc" },
    include: { category: { include: { parent: { include: { parent: true } } } } },
  });

  const positions = buildInstallmentPositions(installments);

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
    }
  >();
  for (const i of installments) {
    const key = `${purchaseBase(i.description)}|${i.amount.toFixed(2)}`;
    const categoryPath = i.category
      ? [i.category.parent?.parent?.name, i.category.parent?.name, i.category.name].filter(Boolean).join(" > ")
      : null;
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
        categoryPath,
        ids: [i.id],
        dueDates: [i.dueDate],
        totalInstallments,
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
      path: [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean).join(" > "),
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

  const [categories, currentTargets] = await Promise.all([
    // Mesmo corte do /budget-summary — investimento não é meta de gasto do
    // Orçamento, não faz sentido revisar aportar aqui. `children: { none: {} }`
    // exclui categoria-mãe (Moradia, Transporte...) — mãe é só rollup pra
    // gráfico geral, meta real sempre é lançada na filha (folha).
    prisma.category.findMany({
      where: { type: "expense", kind: { not: "investment" }, children: { none: {} } },
      include: { parent: { include: { parent: true } } },
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
      // Caminho completo ("Moradia > Aluguel") — várias folhas repetem nome
      // entre pais diferentes de propósito (Aluguel existe em Moradia E em
      // Transporte > Carro), só o nome sozinho não dá pra distinguir.
      const path = [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean).join(" > ");
      return {
        categoryId: c.id,
        name: c.name,
        path,
        kind: c.kind,
        previousSpent: agg._sum.amount ?? 0,
        currentTarget: targetByCategory.get(c.id) ?? null,
      };
    })
  );
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
