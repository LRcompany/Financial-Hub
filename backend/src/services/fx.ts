// Cotação USD/BRL — usada pra converter posições em dólar (Nomad, Phantom)
// pro BRL na hora de gravar o PositionSnapshot. AwesomeAPI é pública, sem
// chave, mantida por devs brasileiros especificamente pra cotação de câmbio.
import { prisma } from "../prisma.js";

const AWESOME_API_URL = "https://economia.awesomeapi.com.br/last/USD-BRL";
const PAIR = "USD-BRL";

let cached: { rate: number; expiresAt: number } | null = null;

async function fetchLiveRate(): Promise<number> {
  const response = await fetch(AWESOME_API_URL);
  if (!response.ok) {
    throw new Error(`Falha ao buscar cotação USD/BRL: ${response.status}`);
  }
  const data = (await response.json()) as { USDBRL: { bid: string } };
  return Number(data.USDBRL.bid);
}

export async function getUsdToBrlRate(): Promise<number> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rate;
  }

  try {
    const rate = await fetchLiveRate();
    cached = { rate, expiresAt: Date.now() + 30 * 60 * 1000 }; // 30min
    // Grava como fallback pra sobreviver a um restart do processo bem no
    // meio de uma janela de rate-limit da API (achado real, 08/09) — nunca
    // deixa a gravação em si quebrar o fluxo principal.
    await prisma.fxRateCache
      .upsert({ where: { pair: PAIR }, update: { rate, fetchedAt: new Date() }, create: { pair: PAIR, rate, fetchedAt: new Date() } })
      .catch(() => {});
    return rate;
  } catch (err) {
    // API externa sem chave/SLA — pode ficar fora do ar ou dar 429 (rate
    // limit por IP; confirmado ao vivo, 08/09, o IP do droplet tomando 429
    // no meio de um "Registrar aporte" em dólar). Cai pro último câmbio que
    // ela realmente devolveu em vez de travar a ação inteira — câmbio não
    // pula o suficiente em poucas horas pra isso importar de verdade.
    const fallback = await prisma.fxRateCache.findUnique({ where: { pair: PAIR } }).catch(() => null);
    if (fallback) {
      // Cache curto (não os 30min normais) — tenta buscar o valor ao vivo
      // de novo na próxima chamada, assim que a API voltar.
      cached = { rate: fallback.rate, expiresAt: Date.now() + 5 * 60 * 1000 };
      return fallback.rate;
    }
    throw err;
  }
}

const historicalCache = new Map<string, number>();

/** Cotação USD/BRL de um dia específico (ex: fim de período de um extrato)
 * — nunca usa a cotação de HOJE pra recotar um mês já fechado (um extrato de
 * julho enviado em agosto tem que usar o câmbio de fim de julho, não o de
 * hoje). Mesma API, endpoint histórico por data. */
export async function getUsdToBrlRateOnDate(dateISO: string): Promise<number> {
  if (historicalCache.has(dateISO)) return historicalCache.get(dateISO)!;

  const compact = dateISO.replace(/-/g, "");
  const response = await fetch(`https://economia.awesomeapi.com.br/json/daily/USD-BRL/?start_date=${compact}&end_date=${compact}`);
  if (!response.ok) {
    throw new Error(`Falha ao buscar cotação histórica USD/BRL de ${dateISO}: ${response.status}`);
  }
  const data = (await response.json()) as { bid: string }[];
  if (data.length === 0) {
    throw new Error(`Sem cotação USD/BRL registrada pra ${dateISO} (dia sem pregão?) — tenta o dia útil mais próximo.`);
  }
  const rate = Number(data[0].bid);
  historicalCache.set(dateISO, rate);
  return rate;
}
