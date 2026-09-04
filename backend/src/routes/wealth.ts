import { Router } from "express";
import { prisma } from "../prisma.js";
import { computeAverageMonthlyReturnPct, projectFirstMillion } from "../services/wealthProjection.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";

export const wealthRouter = Router();

// GET /api/wealth-overview
// Tudo calculado em cima de PositionSnapshot (populado pelo sync da Pluggy ou
// lançamento manual) — sem número fixo. Enquanto não houver snapshot nenhum,
// retorna hasData: false em vez de zero fake.
wealthRouter.get("/wealth-overview", async (_req, res) => {
  const all = await fetchAllSnapshots();

  if (all.length === 0) {
    const wealthGoal = await prisma.wealthGoal.findFirst();
    return res.json({
      hasData: false,
      wealthGoal,
      evolution: [],
      investedByMonth: [],
      allocation: [],
      movers: [],
      avgMonthlyReturnPct: null,
      projection: null,
      yearlyBreakdown: [],
    });
  }

  const nowYm = yearMonth(all[0].year, all[0].month);
  const latestSnaps = activeSnapshotsAsOf(all, nowYm);
  const previousSnaps = activeSnapshotsAsOf(all, nowYm - 1);
  const beforePreviousSnaps = activeSnapshotsAsOf(all, nowYm - 2);

  const total = latestSnaps.reduce((sum, s) => sum + s.marketValue, 0);
  const previousTotal = previousSnaps.reduce((sum, s) => sum + s.marketValue, 0);

  // ---- alocação por tipo de ativo (posições ativas hoje) ----
  // Mesma regra de agrupamento do /api/positions (broker "standalone" vira
  // sua própria fatia, não espalha por tipo) — os dois endpoints têm que
  // bater exatamente, senão Dashboard e Patrimônio mostram número diferente
  // pro mesmo dado (era o caso da Nomad: aqui contava Renda Fixa/Fundo/Moeda
  // separado, lá contava tudo junto como "NOMAD").
  const allocationMap = new Map<string, number>();
  for (const s of latestSnaps) {
    const key = s.broker.standalone ? s.broker.name : s.security.type;
    allocationMap.set(key, (allocationMap.get(key) ?? 0) + s.marketValue);
  }
  const allocation = [...allocationMap.entries()].map(([label, value]) => ({ label, value }));

  // ---- evolução: últimos 12 meses corridos, carregando o último valor ativo de cada mês ----
  // Guarda o investedAmount total junto (não só marketValue) — é o que
  // permite calcular o retorno médio REAL da carteira mais abaixo (separar
  // valorização de mercado de dinheiro novo que entrou).
  const evolution: { label: string; value: number }[] = [];
  const monthlyTotals: { marketValue: number; investedAmount: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ym = nowYm - i;
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    const snaps = activeSnapshotsAsOf(all, ym);
    if (snaps.length === 0) continue; // nada existia ainda nesse mês, não polui o gráfico com zero fake
    evolution.push({
      label: new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      value: snaps.reduce((sum, s) => sum + s.marketValue, 0),
    });
    monthlyTotals.push({
      marketValue: snaps.reduce((sum, s) => sum + s.marketValue, 0),
      investedAmount: snaps.reduce((sum, s) => sum + s.investedAmount, 0),
    });
  }
  const avgMonthlyReturnPct = computeAverageMonthlyReturnPct(monthlyTotals);

  // ---- investido por mês (histórico) — pro gráfico "Investido por mês" ----
  // Mesma ideia de `investedDelta` abaixo, mas mês a mês pra todo o período
  // visível (não só o mês atual x anterior). Precisa de 1 mês a mais de
  // baseline (nowYm-12) só pra conseguir calcular a variação do PRIMEIRO mês
  // visível também — senão o gráfico começaria faltando o primeiro ponto.
  const baselineSnaps = activeSnapshotsAsOf(all, nowYm - 12);
  const baselineInvested = baselineSnaps.length > 0 ? baselineSnaps.reduce((sum, s) => sum + s.investedAmount, 0) : null;
  const investedByMonth: { label: string; value: number }[] = [];
  let prevInvested = baselineInvested;
  for (let idx = 0; idx < monthlyTotals.length; idx++) {
    const current = monthlyTotals[idx].investedAmount;
    if (prevInvested !== null) {
      investedByMonth.push({ label: evolution[idx].label, value: current - prevInvested });
    }
    prevInvested = current;
  }

  // ---- aportes do mês: variação do total investido (não posição por posição) ----
  // Comparar por security individual quebra sempre que a identidade do ativo
  // muda de fonte (ex: histórico manual agregava "AÇÕES" numa linha só, a
  // Pluggy reporta cada ação separada) — o total de investedAmount não
  // depende de identidade, só precisa das somas de cada período.
  function investedDelta(current: { investedAmount: number }[], prior: { investedAmount: number }[]) {
    const totalCurrent = current.reduce((sum, s) => sum + s.investedAmount, 0);
    const totalPrior = prior.reduce((sum, s) => sum + s.investedAmount, 0);
    return totalCurrent - totalPrior;
  }
  const investedThisMonth = investedDelta(latestSnaps, previousSnaps);
  const investedLastMonth = previousSnaps.length > 0 ? investedDelta(previousSnaps, beforePreviousSnaps) : null;

  // ---- proventos: soma do campo dividends do período (null = ainda não coletado, não é 0) ----
  function dividendsSum(snaps: { dividends: number | null }[]): number | null {
    const withData = snaps.filter((s) => s.dividends !== null);
    if (withData.length === 0) return null;
    return withData.reduce((sum, s) => sum + (s.dividends ?? 0), 0);
  }
  const projectedDividends = dividendsSum(latestSnaps);
  const projectedDividendsLastMonth = previousSnaps.length > 0 ? dividendsSum(previousSnaps) : null;

  // ---- destaques do mês: maior variação % por CATEGORIA (não por ativo) ----
  // Antes mostrava o ativo individual (ticker/CUSIP) — pra título de renda
  // fixa isso vira um código sem significado nenhum pra ele (ex: "105756CG3",
  // o CUSIP de um bond da Nomad). Trocado pra a mesma categoria já usada na
  // "Alocação de investimentos" logo acima (tipo do ativo, ou o nome da
  // corretora quando ela é "standalone" tipo Nomad/INCO) — sempre uma
  // categoria reconhecível (Renda Fixa, Ação, FII, NOMAD...), nunca um
  // identificador técnico de ativo.
  function totalByCategory(snaps: { marketValue: number; security: { type: string }; broker: { name: string; standalone: boolean } }[]) {
    const map = new Map<string, number>();
    for (const s of snaps) {
      const key = s.broker.standalone ? s.broker.name : s.security.type;
      map.set(key, (map.get(key) ?? 0) + s.marketValue);
    }
    return map;
  }
  const latestByCategory = totalByCategory(latestSnaps);
  const previousByCategory = totalByCategory(previousSnaps);
  const movers = [...latestByCategory.entries()]
    .map(([category, curValue]) => {
      const priorValue = previousByCategory.get(category);
      // categoria não existia no mês anterior — não dá pra saber "quanto
      // mudou", não inventa 0%, só não aparece como destaque
      if (!priorValue) return null;
      const changePct = ((curValue - priorValue) / priorValue) * 100;
      return { category, changePct };
    })
    .filter((m): m is { category: string; changePct: number } => m !== null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);

  // ---- projeção "primeira milhão" (retorno real + aporte mensal, ver services/wealthProjection.ts) ----
  const wealthGoal = await prisma.wealthGoal.findFirst();
  const { projection, yearlyBreakdown } = projectFirstMillion(
    total,
    wealthGoal?.targetAmount ?? null,
    wealthGoal?.monthlyContribution ?? 0,
    avgMonthlyReturnPct
  );

  res.json({
    hasData: true,
    total,
    previousTotal,
    allocation,
    evolution,
    investedThisMonth,
    investedLastMonth,
    investedByMonth,
    projectedDividends,
    projectedDividendsLastMonth,
    movers,
    wealthGoal,
    avgMonthlyReturnPct,
    projection,
    yearlyBreakdown,
  });
});
