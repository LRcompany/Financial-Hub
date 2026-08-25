// Consulta pública na blockchain Solana — sem Pluggy, sem chave de API.
// Só o endereço público da carteira (nunca a seed phrase/chave privada).
import { prisma } from "../prisma.js";

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
  name: string;
  symbol: string;
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

  let name = mint;
  let symbol = mint.slice(0, 4).toUpperCase();
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/solana/contract/${mint}`);
    if (res.ok) {
      const info = (await res.json()) as { name?: string; symbol?: string };
      if (info.name) name = info.name;
      if (info.symbol) symbol = info.symbol.toUpperCase();
    }
  } catch {
    // fica com o endereço truncado como nome — melhor que travar
  }

  return { name, symbol, priceBRL };
}

/**
 * Sincroniza a carteira Phantom inteira direto da blockchain: SOL nativo +
 * qualquer token SPL com saldo. Token sem preço no CoinGecko é ignorado (não
 * grava com valor 0 fake) — o retorno informa quantos ficaram de fora.
 */
export async function syncOnchainWallet(brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  if (!broker.onchainAddress) throw new Error("Broker sem endereço on-chain configurado");

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // A blockchain não guarda preço de compra — sem como saber o custo real de
  // aquisição. Herda o investedAmount do snapshot anterior (mantém a mesma
  // base de custo ao longo do tempo); na primeira vez, usa o valor de mercado
  // (equivale a "ainda não sei o ganho/perda", não inventa um número).
  async function upsertPosition(securityId: string, name: string, ticker: string, marketValue: number, quantity: number, unitValue: number) {
    const security = await prisma.security.upsert({
      where: { id: securityId },
      update: { name, ticker, type: "Cripto", currency: "BRL" },
      create: { id: securityId, name, ticker, type: "Cripto", currency: "BRL" },
    });
    const previous = await prisma.positionSnapshot.findFirst({
      where: { brokerId: broker.id, securityId: security.id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    const investedAmount = previous?.investedAmount ?? marketValue;
    await prisma.positionSnapshot.upsert({
      where: { brokerId_securityId_month_year: { brokerId: broker.id, securityId: security.id, month, year } },
      update: { marketValue, investedAmount, quantity, unitValue },
      create: { brokerId: broker.id, securityId: security.id, month, year, marketValue, investedAmount, quantity, unitValue },
    });
  }

  const [solBalance, solPriceBRL, tokenBalances] = await Promise.all([
    getSolBalance(broker.onchainAddress),
    getSolPriceBRL(),
    getSplTokenBalances(broker.onchainAddress),
  ]);
  await upsertPosition(`onchain:${broker.id}:SOL`, "Solana (SOL)", "SOL", solBalance * solPriceBRL, solBalance, solPriceBRL);

  let tokensSynced = 0;
  let tokensUnpriced = 0;
  for (const t of tokenBalances) {
    const info = await getTokenInfo(t.mint);
    if (info.priceBRL == null) {
      tokensUnpriced++;
      continue;
    }
    await upsertPosition(`onchain:${broker.id}:${t.mint}`, info.name, info.symbol, t.amount * info.priceBRL, t.amount, info.priceBRL);
    tokensSynced++;
  }

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: now } });

  return { solBalance, solPriceBRL, tokensFound: tokenBalances.length, tokensSynced, tokensUnpriced };
}
