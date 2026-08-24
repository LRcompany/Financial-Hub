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
