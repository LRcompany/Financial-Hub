import { Router } from "express";
import { prisma } from "../prisma.js";
import { projectFirstMillion } from "../services/wealthProjection.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";

export const wealthRouter = Router();

// GET /api/wealth-overview
// Tudo calculado em cima de PositionSnapshot (populado pelo sync da Pluggy ou
// lançamento manual) — sem número fixo. Enquanto não houver snapshot nenhum,
// retorna hasData: false em vez de zero fake.
wealthRouter.get("/wealth-overview", async (_req, res) => {
  const all = await fetchAllSnapshots();

  if (all.length === 0) {
    const [wealthGoal, wealthGoalYearly] = await Promise.all([
      prisma.wealthGoal.findFirst(),
      prisma.wealthGoalYearly.findMany({ orderBy: { year: "asc" } }),
    ]);
    return res.json({
      hasData: false,
      wealthGoal,
      wealthGoalYearly,
      evolution: [],
      allocation: [],
      movers: [],
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
  const allocationMap = new Map<string, number>();
  for (const s of latestSnaps) {
    allocationMap.set(s.security.type, (allocationMap.get(s.security.type) ?? 0) + s.marketValue);
  }
  const allocation = [...allocationMap.entries()].map(([label, value]) => ({ label, value }));

  // ---- evolução: últimos 12 meses corridos, carregando o último valor ativo de cada mês ----
  const evolution: { label: string; value: number }[] = [];
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

  // ---- destaques do mês: maior variação % de valor de mercado por ativo ----
  function marketValueBySecurity(snaps: { securityId: string; marketValue: number; security: { name: string; ticker: string | null } }[]) {
    const map = new Map<string, { name: string; ticker: string | null; value: number }>();
    for (const s of snaps) {
      const existing = map.get(s.securityId);
      map.set(s.securityId, {
        name: s.security.name,
        ticker: s.security.ticker,
        value: (existing?.value ?? 0) + s.marketValue,
      });
    }
    return map;
  }
  const latestBySecurity = marketValueBySecurity(latestSnaps);
  const previousBySecurity = marketValueBySecurity(previousSnaps);
  const movers = [...latestBySecurity.entries()]
    .map(([securityId, cur]) => {
      const prior = previousBySecurity.get(securityId);
      if (!prior || prior.value === 0) return null;
      const changePct = ((cur.value - prior.value) / prior.value) * 100;
      return { ticker: cur.ticker ?? cur.name, changePct };
    })
    .filter((m): m is { ticker: string; changePct: number } => m !== null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);

  // ---- projeção "primeira milhão" (meta ano a ano, ver services/wealthProjection.ts) ----
  const [wealthGoal, wealthGoalYearly] = await Promise.all([
    prisma.wealthGoal.findFirst(),
    prisma.wealthGoalYearly.findMany({ orderBy: { year: "asc" } }),
  ]);
  const { projection, yearlyBreakdown } = projectFirstMillion(total, wealthGoal?.targetAmount ?? null, wealthGoalYearly);

  res.json({
    hasData: true,
    total,
    previousTotal,
    allocation,
    evolution,
    investedThisMonth,
    investedLastMonth,
    projectedDividends,
    projectedDividendsLastMonth,
    movers,
    wealthGoal,
    wealthGoalYearly,
    projection,
    yearlyBreakdown,
  });
});
