// Dólar de fechamento do mês (25/11) — ver docs/blueprint.md.
//
// Luiz: "usar o dólar de fechamento de cada mês para NOMAD e Wise, e no mês
// corrente, o dólar do dia". Achado que motivou: a foto de out/26 da Nomad
// ficou com o dólar a 5,0906 (cotação velha, guardada de quando a API deu
// erro), mas em 30/10 ele estava a 5,4397 — outubro saiu R$2.642 menor e esse
// pedaço do câmbio caiu como "rendimento" em novembro.
//
// Regra, pra toda foto de corretora manual em moeda estrangeira a partir de
// set/2026 (início dos dados que valem):
// - mês fechado → cotação do último dia útil do mês (guardada em
//   FxRateCache como "USD-BRL@2026-10"; uma vez achada, não muda mais);
// - mês corrente → cotação do dia (só se a API respondeu de verdade hoje;
//   cotação velha de reserva não entra).
// Sem cotação confiável, a foto fica como está — nunca chuta.
// Só o valor de mercado (e o preço unitário) muda. O investido em R$ é custo
// e não é recotado; o investido em dólar fica em `investedOriginal`.
import { prisma } from "../prisma.js";
import { FOREIGN_CURRENCIES, getRateToBrl, getRateToBrlOnDate, type ForeignCurrency } from "./fx.js";
import { yearMonth } from "./activePositions.js";
import { FLOW_START_YM } from "./investmentFlows.js";
import { brDayString } from "./dates.js";

export const FX_CLOSE_START_YM = FLOW_START_YM;
const TODAY_RATE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Recota uma foto: o valor na moeda original fica igual, muda só a conversão. */
export function rerate(s: { marketValue: number; unitValue: number | null; fxRateToBRL: number }, rate: number) {
  const k = rate / s.fxRateToBRL;
  return { marketValue: s.marketValue * k, unitValue: s.unitValue == null ? null : s.unitValue * k, fxRateToBRL: rate };
}

/** Dias a tentar pro fechamento: do último dia do mês pra trás (fim de semana/feriado não tem cotação). */
export function closingCandidates(year: number, month: number, n = 7): string[] {
  const last = new Date(Date.UTC(year, month, 0)); // dia 0 do mês seguinte = último deste
  return Array.from({ length: n }, (_, i) => new Date(last.getTime() - i * 86400000).toISOString().slice(0, 10));
}

/** Cotação de fechamento do mês. null = não deu pra saber agora (API fora) — tenta no próximo ciclo. */
export async function closingRate(currency: ForeignCurrency, year: number, month: number): Promise<{ rate: number; day: string } | null> {
  const pair = `${currency}-BRL@${year}-${String(month).padStart(2, "0")}`;
  const hit = await prisma.fxRateCache.findUnique({ where: { pair } });
  if (hit) return { rate: hit.rate, day: hit.fetchedAt.toISOString().slice(0, 10) };
  for (const day of closingCandidates(year, month)) {
    try {
      const rate = await getRateToBrlOnDate(currency, day);
      // fetchedAt guarda o DIA da cotação (meio-dia UTC), não quando foi buscada.
      const fetchedAt = new Date(`${day}T12:00:00.000Z`);
      await prisma.fxRateCache.upsert({ where: { pair }, update: { rate, fetchedAt }, create: { pair, rate, fetchedAt } });
      return { rate, day };
    } catch (err) {
      if (/Sem cotação/.test((err as Error).message)) continue; // dia sem pregão: tenta o anterior
      return null; // erro de rede/429: não chuta
    }
  }
  return null;
}

/** Cotação do dia — só se a API respondeu de verdade (não a reserva velha). */
async function todayRate(currency: ForeignCurrency, today: string): Promise<{ rate: number; day: string } | null> {
  try {
    const rate = await getRateToBrl(currency);
    const row = await prisma.fxRateCache.findUnique({ where: { pair: `${currency}-BRL` } });
    if (!row || Date.now() - row.fetchedAt.getTime() > TODAY_RATE_MAX_AGE_MS) return null;
    return { rate, day: today };
  } catch {
    return null;
  }
}

export type FxChange = {
  snapshotId: string;
  broker: string;
  asset: string;
  year: number;
  month: number;
  rateBefore: number;
  rateAfter: number;
  rateDay: string;
  marketBefore: number;
  marketAfter: number;
};

/** Recota as fotos de Nomad/Wise (corretora manual em moeda estrangeira). `apply: false` só simula. */
export async function refreshForeignSnapshotFx({ apply = true, now = new Date(), fromYm = FX_CLOSE_START_YM } = {}) {
  const today = brDayString(now);
  const nowYm = yearMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const snaps = await prisma.positionSnapshot.findMany({
    where: { broker: { dataSource: "manual_statement" }, security: { currency: { in: [...FOREIGN_CURRENCIES] } }, fxRateToBRL: { gt: 0 } },
    include: { broker: { select: { name: true } }, security: { select: { name: true, ticker: true, currency: true } } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const rates = new Map<string, { rate: number; day: string } | null>();
  const changes: FxChange[] = [];
  const skipped: string[] = [];
  for (const s of snaps) {
    const ym = yearMonth(s.year, s.month);
    if (ym < fromYm || ym > nowYm) continue;
    const currency = s.security.currency as ForeignCurrency;
    const key = `${currency}|${ym}`;
    if (!rates.has(key)) rates.set(key, ym === nowYm ? await todayRate(currency, today) : await closingRate(currency, s.year, s.month));
    const r = rates.get(key);
    const asset = s.security.ticker ?? s.security.name;
    if (!r) {
      skipped.push(`${s.broker.name} ${asset} ${String(s.month).padStart(2, "0")}/${s.year}: sem cotação ${currency} confiável agora`);
      continue;
    }
    if (Math.abs(r.rate - s.fxRateToBRL!) < 1e-6) continue;
    const next = rerate({ marketValue: s.marketValue, unitValue: s.unitValue, fxRateToBRL: s.fxRateToBRL! }, r.rate);
    changes.push({
      snapshotId: s.id,
      broker: s.broker.name,
      asset,
      year: s.year,
      month: s.month,
      rateBefore: s.fxRateToBRL!,
      rateAfter: r.rate,
      rateDay: r.day,
      marketBefore: s.marketValue,
      marketAfter: next.marketValue,
    });
    if (apply) {
      await prisma.positionSnapshot.update({
        where: { id: s.id },
        data: {
          ...next,
          // Garante o investido em dólar antes da troca (foto gravada antes da coluna existir).
          ...(s.investedOriginal == null ? { investedOriginal: s.investedAmount / s.fxRateToBRL! } : {}),
        },
      });
    }
  }
  return { changes, skipped };
}
