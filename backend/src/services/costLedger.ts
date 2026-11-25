// Livro de custo de Ação/FII (25/11) — ver docs/blueprint.md e CostEntry no schema.
//
// Luiz: "Use o preço médio do BTG como base para TODAS as ações e FIIs... A
// partir dessa base, o investido passa a ser calculado pelas movimentações:
// soma as compras e desconta as vendas pelo custo médio das cotas vendidas.
// A Pluggy fica responsável só por quantidade, preço atual e saldo."
//
// Investido numa data = base mais recente (cotas × preço médio do BTG) +
// compras do extrato depois dela − custo médio das cotas vendidas + ajustes.
// Movimento sem quantidade (troca de classe, bonificação, direito de
// subscrição — "EVENTO DE BOLSA") não mexe no custo: fica listado em
// `unresolved` pra ser classificado, nunca chutado.
import { prisma } from "../prisma.js";
import { brDayString } from "./dates.js";

export type LedgerEntry = { id: string; date: Date; kind: string; quantity: number | null; amount: number; revertedAt: Date | null };
export type LedgerMovement = { id: string; date: Date; kind: string; amount: number; quantity: number | null };
export type CostOrigin = "preco_medio_btg" | "movimentacao" | "ajuste";
export type CostState = {
  quantity: number;
  invested: number;
  avgCost: number | null;
  origin: CostOrigin;
  changedAt: Date; // última coisa que mexeu no custo
  baseDate: Date;
  unresolved: { id: string; date: Date; kind: string; amount: number }[];
};

const day = (d: Date) => brDayString(d);

/** Custo de uma posição até `until` (exclusivo). null = ainda sem base (usa a regra antiga). */
export function computeCost(entries: LedgerEntry[], movements: LedgerMovement[], until: Date): CostState | null {
  const live = entries.filter((e) => !e.revertedAt && e.date < until);
  const base = live.filter((e) => e.kind === "base").sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  if (!base) return null;
  const baseDay = day(base.date);
  let quantity = base.quantity ?? 0;
  let invested = base.amount;
  let origin: CostOrigin = "preco_medio_btg";
  let changedAt = base.date;
  const unresolved: CostState["unresolved"] = [];

  // A base já inclui tudo até o fim do dia dela; só conta o que veio depois.
  type Step = { date: Date; apply: () => void };
  const steps: Step[] = [];
  for (const m of movements) {
    if (m.date >= until || day(m.date) <= baseDay) continue;
    if (m.quantity == null || m.quantity <= 0) {
      unresolved.push({ id: m.id, date: m.date, kind: m.kind, amount: m.amount });
      continue;
    }
    const q = m.quantity;
    steps.push({
      date: m.date,
      apply: () => {
        if (m.kind === "aplicacao") {
          quantity += q;
          invested += m.amount;
        } else {
          const sold = Math.min(q, quantity);
          invested -= quantity > 0 ? (invested / quantity) * sold : 0;
          quantity -= sold;
        }
        origin = "movimentacao";
        changedAt = m.date;
      },
    });
  }
  for (const e of live) {
    if (e.kind !== "ajuste" || day(e.date) < baseDay || e.id === base.id) continue;
    steps.push({
      date: e.date,
      apply: () => {
        invested += e.amount;
        origin = "ajuste";
        changedAt = e.date;
      },
    });
  }
  steps.sort((a, b) => a.date.getTime() - b.date.getTime()).forEach((s) => s.apply());
  if (quantity < 1e-9) {
    quantity = 0;
    invested = 0;
  }
  invested = Math.round(invested * 100) / 100;
  return { quantity, invested, avgCost: quantity > 0 ? invested / quantity : null, origin, changedAt, baseDate: base.date, unresolved };
}

/** Lê do banco e calcula o custo de uma posição até `until`. */
export async function ledgerCostAt(securityId: string, until: Date): Promise<CostState | null> {
  const entries = await prisma.costEntry.findMany({ where: { securityId } });
  if (!entries.some((e) => e.kind === "base" && !e.revertedAt)) return null;
  const movements = await prisma.investmentMovement.findMany({ where: { securityId } });
  return computeCost(entries, movements, until);
}

/** Primeiro instante do mês seguinte — "até o fim do mês". */
export const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 1, 3)); // 00:00 de Brasília

/**
 * Regrava o investido de toda foto mensal da posição a partir do mês da base,
 * pelo livro de custo. Foto zerada (posição vendida/sumida) continua zero; o
 * resto nunca fica com zero. Devolve o que mudou (antes → depois).
 */
export async function recomputeSnapshotsFromLedger(securityId: string, now = new Date()) {
  const snaps = await prisma.positionSnapshot.findMany({ where: { securityId }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  const changes: { snapshotId: string; year: number; month: number; before: number; after: number }[] = [];
  for (const s of snaps) {
    const end = monthEnd(s.year, s.month);
    const cost = await ledgerCostAt(securityId, end < now ? end : now);
    if (!cost) continue;
    const isEmpty = (s.quantity ?? 0) <= 0 && s.marketValue <= 0;
    const after = isEmpty ? 0 : cost.invested;
    if (Math.abs(after - s.investedAmount) < 0.005) continue;
    await prisma.positionSnapshot.update({ where: { id: s.id }, data: { investedAmount: after } });
    changes.push({ snapshotId: s.id, year: s.year, month: s.month, before: s.investedAmount, after });
  }
  return changes;
}
