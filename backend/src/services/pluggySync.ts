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

interface PluggyInvestment {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  code?: string | null;
  balance: number;
  amountOriginal?: number | null;
  amount?: number | null;
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

  for (const inv of results) {
    // id sintético e determinístico (pluggy:<id do ativo>) — garante que o upsert
    // sempre bate no mesmo Security em syncs futuros, sem duplicar.
    const security = await prisma.security.upsert({
      where: { id: `pluggy:${inv.id}` },
      update: { name: inv.name, ticker: inv.code ?? null },
      create: {
        id: `pluggy:${inv.id}`,
        name: inv.name,
        ticker: inv.code ?? null,
        type: mapSecurityType(inv),
      },
    });

    await prisma.positionSnapshot.upsert({
      where: {
        brokerId_securityId_month_year: {
          brokerId: broker.id,
          securityId: security.id,
          month,
          year,
        },
      },
      update: {
        investedAmount: inv.amountOriginal ?? inv.amount ?? inv.balance,
        marketValue: inv.balance,
      },
      create: {
        brokerId: broker.id,
        securityId: security.id,
        month,
        year,
        investedAmount: inv.amountOriginal ?? inv.amount ?? inv.balance,
        marketValue: inv.balance,
      },
    });
  }

  await prisma.broker.update({
    where: { id: broker.id },
    data: { lastSyncedAt: now },
  });

  return { count: results.length, month, year };
}
