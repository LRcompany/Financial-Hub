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
//   FxRateCache como "USD-BRL@2026-10"; uma vez achada, não muda mais).
//   Fonte principal: PTAX de venda do Banco Central; reserva: AwesomeAPI
//   (25/11, Luiz: "Se as duas falharem, avise na saúde dos dados em vez de
//   fechar com cotação de outro dia" — aviso `cotacao-fechamento-pendente`);
// - mês corrente → cotação do dia (só se a API respondeu de verdade hoje;
//   cotação velha de reserva não entra).
// Sem cotação confiável, a foto fica como está — nunca chuta.
// Só o valor de mercado (e o preço unitário) muda. O investido em R$ é custo
// e não é recotado; o investido em dólar fica em `investedOriginal`.
import { prisma } from "../prisma.js";
import { FOREIGN_CURRENCIES, getPtaxClosingOfMonth, getRateToBrl, getRateToBrlOnDate, type ForeignCurrency } from "./fx.js";
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

export type ClosingSource = "ptax_venda" | "awesomeapi" | "manual";
export const closingPair = (currency: ForeignCurrency, year: number, month: number) => `${currency}-BRL@${year}-${String(month).padStart(2, "0")}`;

/** Reserva: AwesomeAPI, do último dia do mês pra trás. null = não deu (sem pregão nos 7 dias ou erro). */
async function awesomeClosing(currency: ForeignCurrency, year: number, month: number): Promise<{ rate: number; day: string } | null> {
  for (const day of closingCandidates(year, month)) {
    try {
      return { rate: await getRateToBrlOnDate(currency, day), day };
    } catch (err) {
      if (/Sem cotação/.test((err as Error).message)) continue; // dia sem pregão: tenta o anterior
      return null; // erro de rede/429
    }
  }
  return null;
}

/**
 * Cotação de fechamento do mês: PTAX de venda guardada → PTAX de venda →
 * AwesomeAPI. Fechamento guardado que não veio da PTAX é tentado de novo na
 * PTAX a cada rodada e só é trocado se ela responder. null = nenhuma fonte
 * respondeu — a foto não é recotada e a saúde dos dados avisa.
 */
export async function closingRate(
  currency: ForeignCurrency,
  year: number,
  month: number
): Promise<{ rate: number; day: string; source: ClosingSource } | null> {
  const pair = closingPair(currency, year, month);
  const hit = await prisma.fxRateCache.findUnique({ where: { pair } });
  const cached = hit ? { rate: hit.rate, day: hit.fetchedAt.toISOString().slice(0, 10), source: (hit.source ?? "manual") as ClosingSource } : null;
  if (cached?.source === "ptax_venda") return cached;
  let found: { rate: number; day: string; source: ClosingSource } | null = null;
  try {
    const ptax = await getPtaxClosingOfMonth(currency, year, month);
    if (ptax) found = { ...ptax, source: "ptax_venda" };
  } catch (err) {
    console.error(`[câmbio] PTAX ${currency} ${month}/${year} falhou:`, (err as Error).message);
  }
  if (!found && !cached) {
    const awesome = await awesomeClosing(currency, year, month);
    if (awesome) found = { ...awesome, source: "awesomeapi" };
  }
  if (!found) return cached;
  // fetchedAt guarda o DIA da cotação (meio-dia UTC), não quando foi buscada.
  const fetchedAt = new Date(`${found.day}T12:00:00.000Z`);
  await prisma.fxRateCache.upsert({
    where: { pair },
    update: { rate: found.rate, fetchedAt, source: found.source },
    create: { pair, rate: found.rate, fetchedAt, source: found.source },
  });
  return found;
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
  rateSource: string;
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
  const rates = new Map<string, { rate: number; day: string; source?: string } | null>();
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
      rateSource: r.source ?? "dia",
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
