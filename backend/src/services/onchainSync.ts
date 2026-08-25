// Orquestra o sync de qualquer carteira on-chain (Broker.dataSource =
// "onchain_query") — roteia por Broker.chain pra consulta certa (Solana,
// Bitcoin, Ethereum, Base) e faz o upsert de posição, compartilhado entre
// todas. Nunca usa seed phrase/chave privada — só o endereço público.
import { prisma } from "../prisma.js";
import { getSolBalance, getSolPriceBRL, getSplTokenBalances, getTokenInfo } from "./solana.js";
import { getBtcBalance, getBtcPriceBRL } from "./bitcoin.js";
import { getEvmNativeBalance, getEthPriceBRL, getEvmTokenBalances, getEvmTokenBalanceDirect, getEvmTokenInfo, type EvmChain } from "./evm.js";

/** A blockchain não guarda preço de compra — sem como saber o custo real de
 * aquisição. Herda o investedAmount do snapshot anterior (mantém a mesma
 * base de custo ao longo do tempo); na primeira vez, usa o valor de mercado
 * (equivale a "ainda não sei o ganho/perda", não inventa um número). */
async function upsertPosition(
  brokerId: string,
  securityId: string,
  name: string,
  ticker: string,
  marketValue: number,
  quantity: number,
  unitValue: number
) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const security = await prisma.security.upsert({
    where: { id: securityId },
    update: { name, ticker, type: "Cripto", currency: "BRL" },
    create: { id: securityId, name, ticker, type: "Cripto", currency: "BRL" },
  });
  const previous = await prisma.positionSnapshot.findFirst({
    where: { brokerId, securityId: security.id },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const investedAmount = previous?.investedAmount ?? marketValue;
  await prisma.positionSnapshot.upsert({
    where: { brokerId_securityId_month_year: { brokerId, securityId: security.id, month, year } },
    update: { marketValue, investedAmount, quantity, unitValue },
    create: { brokerId, securityId: security.id, month, year, marketValue, investedAmount, quantity, unitValue },
  });
}

async function syncSolana(brokerId: string, address: string) {
  const [solBalance, solPriceBRL, tokenBalances] = await Promise.all([
    getSolBalance(address),
    getSolPriceBRL(),
    getSplTokenBalances(address),
  ]);
  await upsertPosition(brokerId, `onchain:${brokerId}:SOL`, "Solana (SOL)", "SOL", solBalance * solPriceBRL, solBalance, solPriceBRL);

  let tokensSynced = 0;
  let tokensUnpriced = 0;
  for (const t of tokenBalances) {
    const info = await getTokenInfo(t.mint);
    if (info.priceBRL == null) {
      tokensUnpriced++;
      continue;
    }
    await upsertPosition(brokerId, `onchain:${brokerId}:${t.mint}`, info.name, info.symbol, t.amount * info.priceBRL, t.amount, info.priceBRL);
    tokensSynced++;
  }
  return { solBalance, solPriceBRL, tokensFound: tokenBalances.length, tokensSynced, tokensUnpriced };
}

async function syncBitcoin(brokerId: string, address: string) {
  const [btcBalance, btcPriceBRL] = await Promise.all([getBtcBalance(address), getBtcPriceBRL()]);
  await upsertPosition(brokerId, `onchain:${brokerId}:BTC`, "Bitcoin (BTC)", "BTC", btcBalance * btcPriceBRL, btcBalance, btcPriceBRL);
  return { btcBalance, btcPriceBRL };
}

async function syncEvm(brokerId: string, address: string, chain: EvmChain) {
  const [nativeBalance, nativePriceBRL] = await Promise.all([getEvmNativeBalance(chain, address), getEthPriceBRL()]);
  const nativeLabel = chain === "base" ? "Ethereum (Base)" : "Ethereum (ETH)";
  await upsertPosition(brokerId, `onchain:${brokerId}:${chain}:NATIVE`, nativeLabel, "ETH", nativeBalance * nativePriceBRL, nativeBalance, nativePriceBRL);

  // Contratos que já sabemos de sync anterior — reconferidos direto por RPC
  // mesmo se o indexador (Blockscout) estiver fora do ar agora, pra nunca
  // um holding real conhecido sumir silenciosamente por instabilidade externa.
  const knownSecurities = await prisma.security.findMany({
    where: { id: { startsWith: `onchain:${brokerId}:${chain}:` } },
    select: { id: true },
  });
  const knownContracts = new Set(
    knownSecurities.map((s) => s.id.split(":").pop()!.toLowerCase()).filter((c) => c !== "native")
  );

  let discoveryFailed = false;
  const balances = new Map<string, number>();
  try {
    const discovered = await getEvmTokenBalances(chain, address);
    for (const d of discovered) balances.set(d.contract.toLowerCase(), d.amount);
  } catch {
    discoveryFailed = true;
  }
  for (const contract of knownContracts) {
    if (balances.has(contract)) continue;
    try {
      const amount = await getEvmTokenBalanceDirect(chain, contract, address);
      if (amount > 0) balances.set(contract, amount);
    } catch {
      // token pode ter sido migrado/pausado — ignora, não trava o resto do sync
    }
  }

  let tokensSynced = 0;
  let tokensUnpriced = 0;
  for (const [contract, amount] of balances) {
    if (amount <= 0) continue;
    const info = await getEvmTokenInfo(chain, contract);
    if (info.priceBRL == null) {
      tokensUnpriced++;
      continue;
    }
    await upsertPosition(brokerId, `onchain:${brokerId}:${chain}:${contract}`, info.name, info.symbol, amount * info.priceBRL, amount, info.priceBRL);
    tokensSynced++;
  }

  return { nativeBalance, nativePriceBRL, tokensFound: balances.size, tokensSynced, tokensUnpriced, discoveryFailed };
}

export async function syncOnchainWallet(brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  if (!broker.onchainAddress) throw new Error("Broker sem endereço on-chain configurado");

  let result: Record<string, unknown>;
  switch (broker.chain) {
    case "bitcoin":
      result = await syncBitcoin(broker.id, broker.onchainAddress);
      break;
    case "ethereum":
      result = await syncEvm(broker.id, broker.onchainAddress, "ethereum");
      break;
    case "base":
      result = await syncEvm(broker.id, broker.onchainAddress, "base");
      break;
    case "solana":
    default:
      // back-compat: broker on-chain sem `chain` preenchido ainda é Solana
      // (era a única rede antes desse campo existir).
      result = await syncSolana(broker.id, broker.onchainAddress);
      break;
  }

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: new Date() } });
  return result;
}
