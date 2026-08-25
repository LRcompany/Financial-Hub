// Consulta pública na blockchain Solana — sem Pluggy, sem chave de API.
// Só o endereço público da carteira (nunca a seed phrase/chave privada).
// A orquestração do sync (upsert de posição, roteamento por chain) mora em
// services/onchainSync.ts — aqui só as funções de consulta pura à rede.
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

export async function getSolBalance(address: string): Promise<number> {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
  });
  if (!res.ok) throw new Error(`Falha ao consultar saldo na Solana: ${res.status}`);
  const data = (await res.json()) as { result?: { value: number }; error?: { message: string } };
  if (data.error) throw new Error(`RPC Solana: ${data.error.message}`);
  return (data.result?.value ?? 0) / 1e9; // lamports -> SOL
}

export async function getSolPriceBRL(): Promise<number> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=brl");
  if (!res.ok) throw new Error(`Falha ao buscar cotação do SOL: ${res.status}`);
  const data = (await res.json()) as { solana: { brl: number } };
  return data.solana.brl;
}

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

interface TokenBalance {
  mint: string;
  amount: number;
}

/** Todo token SPL (qualquer cripto que não seja o SOL nativo) na carteira, com saldo > 0. */
export async function getSplTokenBalances(address: string): Promise<TokenBalance[]> {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [address, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }],
    }),
  });
  if (!res.ok) throw new Error(`Falha ao consultar tokens na Solana: ${res.status}`);
  const data = (await res.json()) as {
    result?: { value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number } } } } } }[] };
    error?: { message: string };
  };
  if (data.error) throw new Error(`RPC Solana: ${data.error.message}`);
  return (data.result?.value ?? [])
    .map((v) => ({ mint: v.account.data.parsed.info.mint, amount: v.account.data.parsed.info.tokenAmount.uiAmount }))
    .filter((t) => t.amount > 0);
}

interface TokenInfo {
  // null = não deu pra buscar agora (CoinGecko fora do ar/rate limit) — quem
  // chama decide o que fazer (nunca sobrescrever um nome bom já salvo com
  // esse fallback; ver onchainSync.ts). Já aconteceu de verdade: um rate
  // limit bem na hora do sync gravou o endereço cru como nome permanente.
  name: string | null;
  symbol: string | null;
  priceBRL: number | null; // null = CoinGecko não tem esse token listado, não dá pra precificar
}

/** Nome/símbolo/preço de um token pelo endereço do contrato (CoinGecko cobre a maioria dos
 * tokens com liquidez real na Solana, mas não tudo — memecoin muito nova pode não aparecer). */
export async function getTokenInfo(mint: string): Promise<TokenInfo> {
  let priceBRL: number | null = null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=brl`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, { brl?: number }>;
      priceBRL = data[mint]?.brl ?? data[mint.toLowerCase()]?.brl ?? null;
    }
  } catch {
    // segue sem preço — não trava o sync todo por causa de 1 token
  }

  let name: string | null = null;
  let symbol: string | null = null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/solana/contract/${mint}`);
    if (res.ok) {
      const info = (await res.json()) as { name?: string; symbol?: string };
      name = info.name ?? null;
      symbol = info.symbol ? info.symbol.toUpperCase() : null;
    }
  } catch {
    // null mesmo — melhor não ter nome novo do que gravar o endereço cru
  }

  return { name, symbol, priceBRL };
}

