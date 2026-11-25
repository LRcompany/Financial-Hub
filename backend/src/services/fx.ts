// Cotação de moeda estrangeira → BRL — usada pra converter posições em
// dólar/euro (Nomad, Phantom, Wise) pro BRL na hora de gravar o
// PositionSnapshot, e pra estimar o R$ de contrato de projeto da gringa.
// AwesomeAPI é pública, sem chave, mantida por devs brasileiros
// especificamente pra cotação de câmbio. EUR entrou em 04/11 (Luiz: "às vezes
// eu recebo em projetos da gringa em EUR" + saldo em euro na Wise).
import { prisma } from "../prisma.js";

export const FOREIGN_CURRENCIES = ["USD", "EUR"] as const;
export type ForeignCurrency = (typeof FOREIGN_CURRENCIES)[number];
export const isForeignCurrency = (c: unknown): c is ForeignCurrency => FOREIGN_CURRENCIES.includes(c as ForeignCurrency);

const cached = new Map<ForeignCurrency, { rate: number; expiresAt: number }>();

async function fetchAwesomeRate(currency: ForeignCurrency): Promise<number> {
  const response = await fetch(`https://economia.awesomeapi.com.br/last/${currency}-BRL`);
  if (!response.ok) {
    throw new Error(`Falha ao buscar cotação ${currency}/BRL: ${response.status}`);
  }
  const data = (await response.json()) as Record<string, { bid: string }>;
  return Number(data[`${currency}BRL`].bid);
}

// Segunda fonte (04/11): a AwesomeAPI vive dando 429 pro IP do droplet, e
// uma moeda nova (EUR) ainda não tem a última cotação guardada pra cair nela.
// open.er-api.com é pública, sem chave, atualiza 1x/dia — serve de reserva.
async function fetchErApiRate(currency: ForeignCurrency): Promise<number> {
  const response = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
  if (!response.ok) {
    throw new Error(`Falha ao buscar cotação ${currency}/BRL (reserva): ${response.status}`);
  }
  const data = (await response.json()) as { result: string; rates?: Record<string, number> };
  const rate = data.rates?.BRL;
  if (data.result !== "success" || typeof rate !== "number") throw new Error(`Cotação ${currency}/BRL (reserva) sem valor`);
  return rate;
}

async function fetchLiveRate(currency: ForeignCurrency): Promise<number> {
  try {
    return await fetchAwesomeRate(currency);
  } catch (err) {
    try {
      return await fetchErApiRate(currency);
    } catch {
      throw err;
    }
  }
}

export async function getRateToBrl(currency: ForeignCurrency): Promise<number> {
  const hit = cached.get(currency);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.rate;
  }

  const pair = `${currency}-BRL`;
  try {
    const rate = await fetchLiveRate(currency);
    cached.set(currency, { rate, expiresAt: Date.now() + 30 * 60 * 1000 }); // 30min
    // Grava como fallback pra sobreviver a um restart do processo bem no
    // meio de uma janela de rate-limit da API (achado real, 08/09) — nunca
    // deixa a gravação em si quebrar o fluxo principal.
    await prisma.fxRateCache
      .upsert({ where: { pair }, update: { rate, fetchedAt: new Date() }, create: { pair, rate, fetchedAt: new Date() } })
      .catch(() => {});
    return rate;
  } catch (err) {
    // API externa sem chave/SLA — pode ficar fora do ar ou dar 429 (rate
    // limit por IP; confirmado ao vivo, 08/09, o IP do droplet tomando 429
    // no meio de um "Registrar aporte" em dólar). Cai pro último câmbio que
    // ela realmente devolveu em vez de travar a ação inteira — câmbio não
    // pula o suficiente em poucas horas pra isso importar de verdade.
    const fallback = await prisma.fxRateCache.findUnique({ where: { pair } }).catch(() => null);
    if (fallback) {
      // Cache curto (não os 30min normais) — tenta buscar o valor ao vivo
      // de novo na próxima chamada, assim que a API voltar.
      cached.set(currency, { rate: fallback.rate, expiresAt: Date.now() + 5 * 60 * 1000 });
      return fallback.rate;
    }
    throw err;
  }
}

export const getUsdToBrlRate = () => getRateToBrl("USD");

const historicalCache = new Map<string, number>();

/** Cotação → BRL de um dia específico (ex: fim de período de um extrato)
 * — nunca usa a cotação de HOJE pra recotar um mês já fechado (um extrato de
 * julho enviado em agosto tem que usar o câmbio de fim de julho, não o de
 * hoje). Mesma API, endpoint histórico por data. */
export async function getRateToBrlOnDate(currency: ForeignCurrency, dateISO: string): Promise<number> {
  const key = `${currency}:${dateISO}`;
  if (historicalCache.has(key)) return historicalCache.get(key)!;

  const compact = dateISO.replace(/-/g, "");
  const response = await fetch(`https://economia.awesomeapi.com.br/json/daily/${currency}-BRL/?start_date=${compact}&end_date=${compact}`);
  if (!response.ok) {
    throw new Error(`Falha ao buscar cotação histórica ${currency}/BRL de ${dateISO}: ${response.status}`);
  }
  const data = (await response.json()) as { bid: string }[];
  if (data.length === 0) {
    throw new Error(`Sem cotação ${currency}/BRL registrada pra ${dateISO} (dia sem pregão?) — tenta o dia útil mais próximo.`);
  }
  const rate = Number(data[0].bid);
  historicalCache.set(key, rate);
  return rate;
}

export const getUsdToBrlRateOnDate = (dateISO: string) => getRateToBrlOnDate("USD", dateISO);

/**
 * PTAX de venda do Banco Central no fechamento do mês (25/11, Luiz: "Use a
 * PTAX de venda do Banco Central como fonte principal para o fechamento do
 * mês, e a API atual como reserva"). Boletim "Fechamento" do último dia útil
 * do mês. Pública, sem chave (Olinda/BCB) — e responde do droplet, onde a
 * AwesomeAPI histórica dá 429.
 * Devolve null se o mês não tem boletim de fechamento; lança em erro de rede.
 */
export async function getPtaxClosingOfMonth(currency: ForeignCurrency, year: number, month: number): Promise<{ rate: number; day: string } | null> {
  const last = new Date(Date.UTC(year, month, 0));
  const first = new Date(last.getTime() - 10 * 86400000);
  const mdy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='${currency}'&@dataInicial='${mdy(first)}'&@dataFinalCotacao='${mdy(last)}'&$format=json&$filter=tipoBoletim%20eq%20'Fechamento'`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`PTAX ${currency} ${month}/${year}: HTTP ${response.status}`);
  const data = (await response.json()) as { value?: { cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim: string }[] };
  return pickPtaxClosing(data.value ?? [], year, month);
}

/** Último boletim "Fechamento" dentro do mês (separado pra testar). */
export function pickPtaxClosing(rows: { cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim: string }[], year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const inMonth = rows
    .filter((r) => r.tipoBoletim === "Fechamento" && r.dataHoraCotacao.startsWith(prefix) && r.cotacaoVenda > 0)
    .sort((a, b) => a.dataHoraCotacao.localeCompare(b.dataHoraCotacao));
  const lastRow = inMonth.at(-1);
  return lastRow ? { rate: lastRow.cotacaoVenda, day: lastRow.dataHoraCotacao.slice(0, 10) } : null;
}
