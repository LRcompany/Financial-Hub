// Aplicação/resgate REAL (17/11) — ver `InvestmentMovement` no schema.
//
// Luiz: "hoje o aporte é deduzido pela variação do investido entre meses —
// passe a registrar cada aplicação/resgate e calcule o rendimento do mês como
// valor final − valor inicial − aportes líquidos". Achado que motivou: o BTG
// recalculou o "valor aplicado" do Tesouro (LFT 2029 e IPCA+ 2040) sem
// movimentação nenhuma — a quantidade ficou igual e nov/26 mostrava um
// "resgate" de R$2.824 que não existiu.
//
// Regra: corretora conectada (Pluggy), a partir de set/2026 (início dos dados
// que valem — ver PLAN_START), aporte = soma das movimentações. Antes disso, e
// pra corretora manual/on-chain, continua a variação do investido (lá o
// investido só muda por aporte lançado à mão, então é o mesmo número).

import { prisma } from "../prisma.js";
import { yearMonth } from "./activePositions.js";

export const FLOW_START_YM = yearMonth(2026, 9);

type Movement = { brokerId: string; securityId: string; securityType: string; ym: number; returnYm: number | null; signed: number };

export const ymOfDate = (d: Date) => yearMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);

/** Corretora+tipo cujo aporte vem das movimentações (e não da variação do
 * investido). Só Renda Fixa e Fundo por enquanto: o extrato de Ação/FII da
 * Pluggy mistura evento societário (direito de subscrição da AXIA, restituição
 * de capital) como compra/venda, e ação alugada (BTC) some da posição sem
 * venda nenhuma — ver docs/blueprint.md (17/11). */
const FLOW_TYPES = new Set(["Renda Fixa", "Fundo"]);
export const isFlowFed = (broker: { dataSource: string }, securityType: string) => broker.dataSource === "pluggy" && FLOW_TYPES.has(securityType);

/**
 * Duas réguas por movimentação:
 * - `ym`: mês da DATA dela — é o aporte do mês ("quando o dinheiro entrou").
 * - `returnYm`: mês da primeira foto da posição que JÁ mostra esse dinheiro —
 *   é o que entra no rendimento (valor final − inicial − aportes). Achado real:
 *   o CDB de R$20 mil do Sofisa foi comprado em 30/10, mas a última foto de
 *   outubro foi tirada antes; descontar os 20 mil do rendimento de outubro
 *   (sem o valor deles no mercado) inventava −R$20 mil de rendimento. Foto do
 *   mês da data, tirada depois da movimentação (ou sem horário, de antes de
 *   17/11) → mesmo mês; senão, o mês seguinte com foto. Lançada à mão
 *   (`manual`) ainda não está no valor da corretora → fica fora do rendimento
 *   (`returnYm` null) até a da Pluggy chegar e tomar o lugar dela.
 */
export async function loadMovements() {
  const [rows, snaps] = await Promise.all([
    prisma.investmentMovement.findMany({ include: { security: { select: { type: true } } } }),
    prisma.positionSnapshot.findMany({ select: { securityId: true, year: true, month: true, syncedAt: true, marketValue: true } }),
  ]);
  const snapYms = new Map<string, { ym: number; syncedAt: Date | null }[]>();
  for (const sn of snaps) {
    if (sn.marketValue <= 0) continue;
    const list = snapYms.get(sn.securityId) ?? [];
    list.push({ ym: yearMonth(sn.year, sn.month), syncedAt: sn.syncedAt });
    snapYms.set(sn.securityId, list);
  }
  for (const list of snapYms.values()) list.sort((a, b) => a.ym - b.ym);
  const returnYmOf = (m: (typeof rows)[number]): number | null => {
    if (m.source !== "pluggy") return null;
    const ym = ymOfDate(m.date);
    const list = snapYms.get(m.securityId) ?? [];
    if (m.kind === "resgate") {
      // O valor do mês da data ainda tem o dinheiro se a foto foi tirada antes do resgate.
      const same = list.find((sn) => sn.ym === ym);
      return same?.syncedAt && same.syncedAt.getTime() < m.date.getTime() ? ym + 1 : ym;
    }
    for (const sn of list) {
      if (sn.ym < ym) continue;
      if (sn.ym === ym && sn.syncedAt && sn.syncedAt.getTime() < m.date.getTime()) continue;
      return sn.ym;
    }
    return null; // ainda não apareceu em foto nenhuma
  };
  const list: Movement[] = rows.map((m) => ({
    brokerId: m.brokerId,
    securityId: m.securityId,
    securityType: m.security.type,
    ym: ymOfDate(m.date),
    returnYm: returnYmOf(m),
    signed: m.kind === "resgate" ? -m.amount : m.amount,
  }));
  const add = (map: Map<string, number>, k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v);
  // Em trânsito (20/11): aplicação/resgate do mês que a foto de fim do mês
  // ainda não mostra (`returnYm` ≠ mês da data). Achado real: o CDB de R$20 mil
  // do Sofisa comprado em 30/10 não estava na foto de outubro — o total de
  // outubro ficava R$20 mil menor e o rendimento ia −20 mil em out e +20 mil
  // em nov. Entra no total do mês da data pelo valor aplicado (resgate: sai),
  // e o aporte fica no mês da data. Só Renda Fixa/Fundo (os que têm aporte por
  // movimentação — Ação/FII é variação do investido, ver FLOW_TYPES).
  const transitByYmKey = new Map<number, Map<string, number>>();
  const byKeyYm = new Map<string, number>(); // `${brokerId}:${type}|${ym}`
  const returnByKeyYm = new Map<string, number>();
  const returnBySecurityYm = new Map<string, number>(); // `${securityId}|${ym}`
  for (const m of list) {
    const key = `${m.brokerId}:${m.securityType}`;
    add(byKeyYm, `${key}|${m.ym}`, m.signed);
    if (m.returnYm !== null) {
      add(returnByKeyYm, `${key}|${m.returnYm}`, m.signed);
      add(returnBySecurityYm, `${m.securityId}|${m.returnYm}`, m.signed);
    }
    if (m.returnYm !== m.ym && m.ym >= FLOW_START_YM && FLOW_TYPES.has(m.securityType)) {
      const byKey = transitByYmKey.get(m.ym) ?? new Map<string, number>();
      add(byKey, key, m.signed);
      transitByYmKey.set(m.ym, byKey);
    }
  }
  return {
    /** Aporte líquido (aplicação − resgate) de uma corretora+tipo no mês da data. */
    ofKey: (key: string, ym: number) => byKeyYm.get(`${key}|${ym}`) ?? 0,
    /** Aporte que já aparece no valor da foto desse mês (régua do rendimento). */
    returnOfKey: (key: string, ym: number) => returnByKeyYm.get(`${key}|${ym}`) ?? 0,
    returnOfSecurity: (securityId: string, ym: number) => returnBySecurityYm.get(`${securityId}|${ym}`) ?? 0,
    /** Aplicação (+) / resgate (−) do mês que a foto de fim do mês ainda não mostra, por corretora+tipo. */
    transitByKey: (ym: number) => transitByYmKey.get(ym) ?? new Map<string, number>(),
    keysWithFlow: (ym: number) => [...new Set(list.filter((m) => m.ym === ym || m.returnYm === ym).map((m) => `${m.brokerId}:${m.securityType}`))],
  };
}

export type Flows = Awaited<ReturnType<typeof loadMovements>>;

/** Pluggy BUY/SELL → movimentação. Outros tipos (INTEREST, TAX, AMORTIZATION…) não são aporte. */
export function movementFromPluggy(t: { type: string; amount: number; quantity: number | null }): { kind: "aplicacao" | "resgate"; amount: number } | null {
  if (Math.abs(t.amount) < 0.01) return null; // evento de custódia sem dinheiro (direito de subscrição, desdobramento)
  if (t.type === "BUY") return { kind: "aplicacao", amount: Math.abs(t.amount) };
  if (t.type === "SELL") return { kind: "resgate", amount: Math.abs(t.amount) };
  return null;
}

/** Lançada à mão enquanto a Pluggy não trazia — a da Pluggy chegou, a manual sai
 * (mesmo ativo e tipo, valor até 1% / R$5 de diferença, até 7 dias de distância). */
export async function dropSupersededManualMovements(securityId: string) {
  const [manual, pluggy] = await Promise.all([
    prisma.investmentMovement.findMany({ where: { securityId, source: "manual" } }),
    prisma.investmentMovement.findMany({ where: { securityId, source: "pluggy" } }),
  ]);
  const used = new Set<string>();
  const removed: string[] = [];
  for (const m of manual) {
    const match = pluggy.find(
      (p) =>
        !used.has(p.id) &&
        p.kind === m.kind &&
        Math.abs(p.amount - m.amount) <= Math.max(5, m.amount * 0.01) &&
        Math.abs(p.date.getTime() - m.date.getTime()) <= 7 * 864e5
    );
    if (!match) continue;
    used.add(match.id);
    await prisma.investmentMovement.delete({ where: { id: m.id } });
    removed.push(m.id);
  }
  return removed;
}

/** "105% do CDI", "Selic + 0,11% a.a.", "IPCA + 7,30% a.a.", "15,30% a.a." — ou null se a taxa não é conhecida. */
export function rateLabel(s: { fixedAnnualRate: number | null; rate: number | null; rateType: string | null; name?: string }): string | null {
  const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  const fixed = s.fixedAnnualRate ?? 0;
  const rate = s.rate ?? 0;
  const type = s.rateType?.toUpperCase() ?? null;
  if (type === "CDI") {
    if (fixed > 0 && (rate === 0 || rate === 100)) return `CDI + ${pct(fixed)} a.a.`;
    if (rate > 0) return `${pct(rate)} do CDI${fixed > 0 ? ` + ${pct(fixed)} a.a.` : ""}`;
    return null;
  }
  if (type === "SELIC") return fixed > 0 ? `Selic + ${pct(fixed)} a.a.` : "Selic";
  if (type === "IPCA") return fixed > 0 ? `IPCA + ${pct(fixed)} a.a.` : null;
  if (fixed > 0) return `${pct(fixed)} a.a.`;
  // Bond lançado à mão (Nomad) traz o cupom no nome: "BRAZIL ... 6.25%, 03/18/2031".
  const coupon = s.name?.match(/(\d+(?:[.,]\d+)?)%/);
  if (coupon) return `cupom ${pct(Number(coupon[1].replace(",", ".")))} a.a.`;
  return null;
}

/** Título pós-fixado (Selic/CDI) — rendimento do mês nunca deveria ser negativo. */
export const isPostFixed = (s: { rateType: string | null }) => ["CDI", "SELIC"].includes(s.rateType?.toUpperCase() ?? "");
