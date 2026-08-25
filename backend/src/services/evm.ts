// Consulta pública em blockchains EVM (Ethereum, Base) — sem chave de API,
// só o endereço público (nunca a seed phrase/chave privada). RPC público pro
// saldo nativo (sempre confiável); Blockscout (indexador aberto, sem chave)
// pra descobrir todo token ERC-20 da carteira — quando o Blockscout está
// fora do ar, a descoberta automática falha mas o saldo nativo continua
// funcionando (RPC não depende de indexador).
export type EvmChain = "ethereum" | "base";

const RPC_URL: Record<EvmChain, string> = {
  ethereum: "https://ethereum.publicnode.com",
  base: "https://mainnet.base.org",
};

// Blockscout indexa cada rede num domínio próprio, mesma API v2, sem chave.
const BLOCKSCOUT_URL: Record<EvmChain, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
};

// Id de plataforma que a CoinGecko usa pra cada rede (contrato de token e preço).
const COINGECKO_PLATFORM: Record<EvmChain, string> = {
  ethereum: "ethereum",
  base: "base",
};

async function rpcCall(chain: EvmChain, method: string, params: unknown[]): Promise<string> {
  const res = await fetch(RPC_URL[chain], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Falha ao consultar RPC ${chain}: ${res.status}`);
  const data = (await res.json()) as { result?: string; error?: { message: string } };
  if (data.error) throw new Error(`RPC ${chain}: ${data.error.message}`);
  return data.result ?? "0x0";
}

/** Saldo nativo (ETH, tanto na Ethereum quanto na Base — a Base usa ETH como
 * gas token). Via RPC direto, não depende de indexador. */
export async function getEvmNativeBalance(chain: EvmChain, address: string): Promise<number> {
  const hex = await rpcCall(chain, "eth_getBalance", [address, "latest"]);
  return Number(BigInt(hex)) / 1e18;
}

export async function getEthPriceBRL(): Promise<number> {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=brl");
  if (!res.ok) throw new Error(`Falha ao buscar cotação do ETH: ${res.status}`);
  const data = (await res.json()) as { ethereum: { brl: number } };
  return data.ethereum.brl;
}

interface EvmTokenBalance {
  contract: string;
  amount: number;
}

/** Todo token ERC-20 da carteira, via Blockscout (indexador público, sem
 * chave). Pode falhar se o Blockscout daquela rede estiver fora do ar —
 * quem chama decide o que fazer (não trava o sync do saldo nativo). */
export async function getEvmTokenBalances(chain: EvmChain, address: string): Promise<EvmTokenBalance[]> {
  const res = await fetch(`${BLOCKSCOUT_URL[chain]}/api/v2/addresses/${address}/token-balances`);
  if (!res.ok) throw new Error(`Blockscout (${chain}) fora do ar ou com erro: ${res.status}`);
  const data = (await res.json()) as { token: { address: string; decimals: string | null }; value: string }[];
  if (!Array.isArray(data)) throw new Error(`Blockscout (${chain}): resposta inesperada`);
  return data
    .filter((t) => t.token.decimals != null)
    .map((t) => ({
      contract: t.token.address,
      amount: Number(BigInt(t.value)) / 10 ** Number(t.token.decimals),
    }))
    .filter((t) => t.amount > 0);
}

/** Saldo de um contrato ERC-20 específico via `balanceOf`, direto por RPC —
 * não depende do indexador. Serve pra reconferir um token que já sabemos
 * que existe (self-healing quando o Blockscout está fora do ar). */
export async function getEvmTokenBalanceDirect(chain: EvmChain, contract: string, owner: string): Promise<number> {
  const selector = "0x70a08231"; // balanceOf(address)
  const data = selector + owner.slice(2).padStart(64, "0");
  const balanceHex = await rpcCall(chain, "eth_call", [{ to: contract, data }, "latest"]);
  const decimalsHex = await rpcCall(chain, "eth_call", [{ to: contract, data: "0x313ce567" }, "latest"]); // decimals()
  const decimals = Number(BigInt(decimalsHex));
  return Number(BigInt(balanceHex)) / 10 ** decimals;
}

interface EvmTokenInfo {
  // null = não deu pra buscar agora (CoinGecko fora do ar/rate limit) — quem
  // chama decide o que fazer (nunca sobrescrever um nome bom já salvo com
  // esse fallback; ver onchainSync.ts).
  name: string | null;
  symbol: string | null;
  priceBRL: number | null;
}

/** Nome/símbolo/preço de um token ERC-20 pelo endereço do contrato, via
 * CoinGecko (cobre a maioria dos tokens com liquidez real — memecoin muito
 * nova pode não aparecer). */
export async function getEvmTokenInfo(chain: EvmChain, contract: string): Promise<EvmTokenInfo> {
  const platform = COINGECKO_PLATFORM[chain];
  let priceBRL: number | null = null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contract}&vs_currencies=brl`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, { brl?: number }>;
      priceBRL = data[contract]?.brl ?? data[contract.toLowerCase()]?.brl ?? null;
    }
  } catch {
    // segue sem preço — não trava o sync todo por causa de 1 token
  }

  let name: string | null = null;
  let symbol: string | null = null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${platform}/contract/${contract}`);
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
