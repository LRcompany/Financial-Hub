// Persiste investimentos reais da Pluggy no banco (Security + PositionSnapshot).
// Campos confirmados em docs.pluggy.ai/reference/investments-list (24/08/2026):
// type: COE | EQUITY | ETF | FIXED_INCOME | MUTUAL_FUND | SECURITY | OTHER
// subtype: STOCK | REAL_ESTATE_FUND | ... | balance (valor de mercado) | amountOriginal (custo)
//
// TODO: dividendos do mês não vêm nesse payload — precisam de
// GET /investments/{id}/transactions filtrando por tipo de rendimento.
// Até isso ser implementado, PositionSnapshot.dividends fica null (não é 0 fake,
// é "ainda não coletado").

import { prisma } from "../prisma.js";
import { getInvestments } from "./pluggy.js";
import { getUsdToBrlRate } from "./fx.js";

interface PluggyInvestment {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  code?: string | null;
  balance: number;
  amountOriginal?: number | null;
  amount?: number | null;
  currencyCode?: string; // "BRL" | "USD" | ...
}

function mapSecurityType(inv: PluggyInvestment): string {
  if (inv.subtype === "REAL_ESTATE_FUND") return "FII";
  if (inv.subtype === "STOCK" || inv.type === "EQUITY") return "Ação";
  if (inv.type === "FIXED_INCOME") return "Renda Fixa";
  if (inv.type === "MUTUAL_FUND" || inv.type === "ETF") return "Fundo";
  return "Outro";
}

/** Sincroniza os investimentos de um item (conexão) da Pluggy pro Broker correspondente. */
export async function syncBrokerInvestments(brokerId: string, itemId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });

  const { results } = (await getInvestments(itemId)) as { results: PluggyInvestment[] };

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Só busca a cotação se algum ativo desse sync realmente vier em moeda
  // estrangeira — evita chamada desnecessária pro caso comum (tudo em BRL).
  const needsFx = results.some((inv) => inv.currencyCode && inv.currencyCode !== "BRL");
  const usdRate = needsFx ? await getUsdToBrlRate() : null;

  for (const inv of results) {
    const currency = inv.currencyCode ?? "BRL";
    // Hoje só sabemos converter USD (é o único caso real — Nomad/Phantom).
    // Outra moeda estrangeira ainda não suportada: grava sem converter e
    // deixa fxRateToBRL null, pra não fingir uma conversão que não fizemos.
    const fxRate = currency === "USD" ? usdRate : null;
    const convert = (v: number) => (fxRate ? v * fxRate : v);

    // id sintético e determinístico (pluggy:<id do ativo>) — garante que o upsert
    // sempre bate no mesmo Security em syncs futuros, sem duplicar.
    const security = await prisma.security.upsert({
      where: { id: `pluggy:${inv.id}` },
      update: { name: inv.name, ticker: inv.code ?? null, currency },
      create: {
        id: `pluggy:${inv.id}`,
        name: inv.name,
        ticker: inv.code ?? null,
        type: mapSecurityType(inv),
        currency,
      },
    });

    const investedAmount = convert(inv.amountOriginal ?? inv.amount ?? inv.balance);
    const marketValue = convert(inv.balance);

    await prisma.positionSnapshot.upsert({
      where: {
        brokerId_securityId_month_year: {
          brokerId: broker.id,
          securityId: security.id,
          month,
          year,
        },
      },
      update: { investedAmount, marketValue, fxRateToBRL: fxRate },
      create: { brokerId: broker.id, securityId: security.id, month, year, investedAmount, marketValue, fxRateToBRL: fxRate },
    });
  }

  await prisma.broker.update({
    where: { id: broker.id },
    data: { lastSyncedAt: now },
  });

  return { count: results.length, month, year };
}
