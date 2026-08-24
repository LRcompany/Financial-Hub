import { Router } from "express";
import { prisma } from "../prisma.js";

export const wealthRouter = Router();

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// GET /api/wealth-overview
// Tudo calculado em cima de PositionSnapshot (populado pelo sync da Pluggy ou
// lançamento manual) — sem número fixo. Enquanto não houver snapshot nenhum,
// retorna hasData: false em vez de zero fake.
wealthRouter.get("/wealth-overview", async (_req, res) => {
  const periods = await prisma.positionSnapshot.groupBy({
    by: ["month", "year"],
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  if (periods.length === 0) {
    const wealthGoal = await prisma.wealthGoal.findFirst();
    return res.json({ hasData: false, wealthGoal, evolution: [], allocation: [], movers: [] });
  }

  const latest = periods[0];
  const previous = periods[1] ?? null;
  const beforePrevious = periods[2] ?? null;

  const [latestSnaps, previousSnaps, beforePreviousSnaps] = await Promise.all([
    prisma.positionSnapshot.findMany({ where: latest, include: { security: true, broker: true } }),
    previous
      ? prisma.positionSnapshot.findMany({ where: previous, include: { security: true, broker: true } })
      : Promise.resolve([]),
    beforePrevious
      ? prisma.positionSnapshot.findMany({ where: beforePrevious, include: { security: true, broker: true } })
      : Promise.resolve([]),
  ]);

  const total = latestSnaps.reduce((sum, s) => sum + s.marketValue, 0);
  const previousTotal = previousSnaps.reduce((sum, s) => sum + s.marketValue, 0);

  // ---- alocação por tipo de ativo (mês mais recente) ----
  const allocationMap = new Map<string, number>();
  for (const s of latestSnaps) {
    allocationMap.set(s.security.type, (allocationMap.get(s.security.type) ?? 0) + s.marketValue);
  }
  const allocation = [...allocationMap.entries()].map(([label, value]) => ({ label, value }));

  // ---- evolução (últimos 12 períodos com dado, mais antigo primeiro) ----
  const last12 = [...periods].reverse().slice(-12);
  const evolution = await Promise.all(
    last12.map(async (p) => {
      const agg = await prisma.positionSnapshot.aggregate({
        where: { month: p.month, year: p.year },
        _sum: { marketValue: true },
      });
      return {
        label: new Date(p.year, p.month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        value: agg._sum.marketValue ?? 0,
      };
    })
  );

  // ---- aportes do mês: soma dos aumentos de valor investido por posição ----
  function keyOf(s: { brokerId: string; securityId: string }) {
    return `${s.brokerId}:${s.securityId}`;
  }
  function investedDelta(
    current: { brokerId: string; securityId: string; investedAmount: number }[],
    prior: { brokerId: string; securityId: string; investedAmount: number }[]
  ) {
    const priorMap = new Map(prior.map((s) => [keyOf(s), s.investedAmount]));
    return current.reduce((sum, s) => {
      const before = priorMap.get(keyOf(s)) ?? 0;
      return sum + Math.max(0, s.investedAmount - before);
    }, 0);
  }
  const investedThisMonth = investedDelta(latestSnaps, previousSnaps);
  const investedLastMonth = previous ? investedDelta(previousSnaps, beforePreviousSnaps) : null;

  // ---- proventos: soma do campo dividends do período (null = ainda não coletado, não é 0) ----
  function dividendsSum(snaps: { dividends: number | null }[]): number | null {
    const withData = snaps.filter((s) => s.dividends !== null);
    if (withData.length === 0) return null;
    return withData.reduce((sum, s) => sum + (s.dividends ?? 0), 0);
  }
  const projectedDividends = dividendsSum(latestSnaps);
  const projectedDividendsLastMonth = previous ? dividendsSum(previousSnaps) : null;

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

  // ---- projeção "primeira milhão" ----
  const wealthGoal = await prisma.wealthGoal.findFirst();
  let projection: { monthsToGoal: number; projectedDate: string } | null = null;
  if (wealthGoal && total < wealthGoal.targetAmount) {
    const monthlyRate = Math.pow(1 + wealthGoal.annualReturnAssumptionPct / 100, 1 / 12) - 1;
    let balance = total;
    let months = 0;
    const MAX_MONTHS = 600; // 50 anos — teto de segurança
    while (balance < wealthGoal.targetAmount && months < MAX_MONTHS) {
      balance = balance * (1 + monthlyRate) + wealthGoal.monthlySavingsTarget;
      months++;
    }
    if (months < MAX_MONTHS) {
      projection = { monthsToGoal: months, projectedDate: addMonths(new Date(), months).toISOString() };
    }
  } else if (wealthGoal && total >= wealthGoal.targetAmount) {
    projection = { monthsToGoal: 0, projectedDate: new Date().toISOString() };
  }

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
    projection,
  });
});
