// Persiste investimentos reais da Pluggy no banco (Security + PositionSnapshot).
// Campos confirmados em docs.pluggy.ai/reference/investments-list (24/08/2026):
// type: COE | EQUITY | ETF | FIXED_INCOME | MUTUAL_FUND | SECURITY | OTHER
// subtype: STOCK | REAL_ESTATE_FUND | ... | balance (valor de mercado) | amountOriginal (custo)
//
// TODO: dividendos do mês não vêm nesse payload — precisam de
// GET /investments/{id}/transactions filtrando por tipo de rendimento.
// Até isso ser implementado, PositionSnapshot.dividends fica null (não é 0 fake,
// é "ainda não coletado").
//
// Descoberta real (25/08/2026): "CDB de liquidez diária" de conta digital
// (99, e também uma conta específica do BTG) não aparece em GET /investments
// — a Pluggy nem sempre modela isso como um Investment separado. O saldo de
// verdade vem em GET /accounts, campo `bankData.automaticallyInvestedBalance`
// da conta BANK. Sem isso, a posição ficava congelada num valor manual
// antigo pra sempre (nunca tinha uma fonte automática pra "graduar" — ver
// activePositions.ts). Por isso `syncBrokerInvestments` busca as duas coisas.

import { prisma } from "../prisma.js";
import { getInvestments, getAccounts } from "./pluggy.js";
import { getUsdToBrlRate } from "./fx.js";

interface PluggyAccount {
  id: string;
  type: string; // BANK | CREDIT
  currencyCode?: string;
  bankData?: { automaticallyInvestedBalance?: number | null } | null;
}

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
  lastMonthRate?: number | null;
  lastTwelveMonthsRate?: number | null;
  quantity?: number | null;
  value?: number | null;
  isin?: string | null;
  issuer?: string | null;
  dueDate?: string | null;
  fixedAnnualRate?: number | null;
  ratePeriodicity?: string | null;
}

// Tickers de FII conhecidos da carteira — a Pluggy manda esses como
// type: EQUITY (igual ação normal), sem subtype REAL_ESTATE_FUND, então o
// campo type/subtype sozinho não dá pra confiar. B3 reserva sufixo 11/12
// pra fundo (FII/FI-Infra/FI-Agro), mas isso não é garantia universal (units
// de empresa comum também usam 11) — por segurança, checa só contra prefixos
// de FII conhecidos em vez de aplicar a regra de sufixo pra qualquer ticker.
const KNOWN_FII_PREFIXES = new Set([
  "HGLG", "MXRF", "KNRI", "HGRE", "VISC", "ALZR", "XPLG", "KNCR", "HTMX", "KNSC", "PLRI", "HGPO",
]);

function mapSecurityType(inv: PluggyInvestment): string {
  const tickerPrefix = inv.code?.replace(/[0-9]+$/, "");
  if (tickerPrefix && KNOWN_FII_PREFIXES.has(tickerPrefix)) return "FII";
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
      // type entra no update também — se o mapeamento melhorar depois (como
      // agora, corrigindo FII que a Pluggy manda como EQUITY comum), o
      // próximo sync corrige sozinho, sem precisar de script manual de novo.
      update: {
        name: inv.name,
        ticker: inv.code ?? null,
        currency,
        type: mapSecurityType(inv),
        isin: inv.isin ?? null,
        issuer: inv.issuer ?? null,
        dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
        fixedAnnualRate: inv.fixedAnnualRate ?? null,
        ratePeriodicity: inv.ratePeriodicity ?? null,
      },
      create: {
        id: `pluggy:${inv.id}`,
        name: inv.name,
        ticker: inv.code ?? null,
        type: mapSecurityType(inv),
        currency,
        isin: inv.isin ?? null,
        issuer: inv.issuer ?? null,
        dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
        fixedAnnualRate: inv.fixedAnnualRate ?? null,
        ratePeriodicity: inv.ratePeriodicity ?? null,
      },
    });

    const investedAmount = convert(inv.amountOriginal ?? inv.amount ?? inv.balance);
    const marketValue = convert(inv.balance);
    const monthlyRatePct = inv.lastMonthRate ?? null;
    const annualRatePct = inv.lastTwelveMonthsRate ?? null;
    const quantity = inv.quantity ?? null;
    const unitValue = inv.value ?? null;

    await prisma.positionSnapshot.upsert({
      where: {
        brokerId_securityId_month_year: {
          brokerId: broker.id,
          securityId: security.id,
          month,
          year,
        },
      },
      update: { investedAmount, marketValue, fxRateToBRL: fxRate, monthlyRatePct, annualRatePct, quantity, unitValue },
      create: {
        brokerId: broker.id,
        securityId: security.id,
        month,
        year,
        investedAmount,
        marketValue,
        fxRateToBRL: fxRate,
        monthlyRatePct,
        annualRatePct,
        quantity,
        unitValue,
      },
    });
  }

  // "CDB de liquidez diária" embutido na conta corrente — não vem em
  // /investments, vem em /accounts (ver nota no topo do arquivo). Cada conta
  // BANK com esse campo > 0 vira sua própria posição "CDB - Liquidez Diária".
  const { results: accounts } = (await getAccounts(itemId)) as { results: PluggyAccount[] };
  let autoInvestCount = 0;
  for (const acc of accounts) {
    const autoInvested = acc.bankData?.automaticallyInvestedBalance;
    if (autoInvested == null || autoInvested <= 0) continue;

    const securityId = `pluggy:autoinvest:${acc.id}`;
    const currency = acc.currencyCode ?? "BRL";
    const security = await prisma.security.upsert({
      where: { id: securityId },
      update: { name: "CDB - Liquidez Diária", type: "Renda Fixa", currency },
      create: { id: securityId, name: "CDB - Liquidez Diária", type: "Renda Fixa", currency },
    });

    // A Pluggy só manda o saldo atual, não separa "quanto entrou" de "quanto
    // rendeu" — mesma regra do sync on-chain: herda o investido do snapshot
    // anterior (mantém a base de custo), ou usa o valor de mercado a primeira vez.
    const previous = await prisma.positionSnapshot.findFirst({
      where: { brokerId: broker.id, securityId: security.id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    const investedAmount = previous?.investedAmount ?? autoInvested;

    await prisma.positionSnapshot.upsert({
      where: { brokerId_securityId_month_year: { brokerId: broker.id, securityId: security.id, month, year } },
      update: { investedAmount, marketValue: autoInvested },
      create: { brokerId: broker.id, securityId: security.id, month, year, investedAmount, marketValue: autoInvested },
    });
    autoInvestCount++;
  }

  await prisma.broker.update({
    where: { id: broker.id },
    data: { lastSyncedAt: now },
  });

  return { count: results.length + autoInvestCount, investmentsCount: results.length, autoInvestCount, month, year };
}
