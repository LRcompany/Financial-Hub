// Cotação USD/BRL — usada pra converter posições em dólar (Nomad, Phantom)
// pro BRL na hora de gravar o PositionSnapshot. AwesomeAPI é pública, sem
// chave, mantida por devs brasileiros especificamente pra cotação de câmbio.
const AWESOME_API_URL = "https://economia.awesomeapi.com.br/last/USD-BRL";

let cached: { rate: number; expiresAt: number } | null = null;

export async function getUsdToBrlRate(): Promise<number> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rate;
  }

  const response = await fetch(AWESOME_API_URL);
  if (!response.ok) {
    throw new Error(`Falha ao buscar cotação USD/BRL: ${response.status}`);
  }
  const data = (await response.json()) as { USDBRL: { bid: string } };
  const rate = Number(data.USDBRL.bid);

  cached = { rate, expiresAt: Date.now() + 30 * 60 * 1000 }; // 30min
  return rate;
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
