// Consulta pública na blockchain Bitcoin — sem chave de API, só o endereço
// público (nunca a seed phrase/chave privada). API pública da Blockstream
// (mesma empresa por trás do node de referência, endpoint sem autenticação).
const BLOCKSTREAM_API = "https://blockstream.info/api";

export async function getBtcBalance(address: string): Promise<number> {
  const res = await fetch(`${BLOCKSTREAM_API}/address/${address}`);
  if (!res.ok) throw new Error(`Falha ao consultar saldo no Bitcoin: ${res.status}`);
  const data = (await res.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const sats =
    data.chain_stats.funded_txo_sum -
    data.chain_stats.spent_txo_sum +
    data.mempool_stats.funded_txo_sum -
    data.mempool_stats.spent_txo_sum;
  return sats / 1e8; // satoshis -> BTC
}

export async function getBtcPriceBRL(): Promise<number> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl");
  if (!res.ok) throw new Error(`Falha ao buscar cotação do BTC: ${res.status}`);
  const data = (await res.json()) as { bitcoin: { brl: number } };
  return data.bitcoin.brl;
}
