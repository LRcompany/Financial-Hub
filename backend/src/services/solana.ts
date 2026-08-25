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

/**
 * Sincroniza o saldo nativo de SOL de uma carteira Phantom direto da blockchain.
 * TODO: só cobre SOL — tokens SPL (outras criptos na mesma carteira) ainda
 * não são consultados, precisaria de getTokenAccountsByOwner + preço de cada
 * token individualmente. Escopo de quando ele mandar quais tokens tem lá.
 */
export async function syncOnchainWallet(brokerId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });
  if (!broker.onchainAddress) throw new Error("Broker sem endereço on-chain configurado");

  const [solBalance, priceBRL] = await Promise.all([getSolBalance(broker.onchainAddress), getSolPriceBRL()]);
  const marketValue = solBalance * priceBRL;

  const security = await prisma.security.upsert({
    where: { id: `onchain:${broker.id}:SOL` },
    update: { name: "Solana (SOL)", ticker: "SOL", type: "Cripto", currency: "BRL" },
    create: { id: `onchain:${broker.id}:SOL`, name: "Solana (SOL)", ticker: "SOL", type: "Cripto", currency: "BRL" },
  });

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // A blockchain não guarda preço de compra — sem como saber o custo real de
  // aquisição. Herda o investedAmount do snapshot anterior (mantém a mesma
  // base de custo ao longo do tempo); na primeira vez, usa o valor de mercado
  // (equivale a "ainda não sei o ganho/perda", não inventa um número).
  const previous = await prisma.positionSnapshot.findFirst({
    where: { brokerId: broker.id, securityId: security.id },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const investedAmount = previous?.investedAmount ?? marketValue;

  await prisma.positionSnapshot.upsert({
    where: { brokerId_securityId_month_year: { brokerId: broker.id, securityId: security.id, month, year } },
    update: { marketValue, investedAmount, quantity: solBalance, unitValue: priceBRL },
    create: { brokerId: broker.id, securityId: security.id, month, year, marketValue, investedAmount, quantity: solBalance, unitValue: priceBRL },
  });

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: now } });

  return { solBalance, priceBRL, marketValue };
}
