// Persiste investimentos reais da Pluggy no banco (Security + PositionSnapshot).
// Campos confirmados em docs.pluggy.ai/reference/investments-list (24/08/2026):
// type: COE | EQUITY | ETF | FIXED_INCOME | MUTUAL_FUND | SECURITY | OTHER
// subtype: STOCK | REAL_ESTATE_FUND | ... | balance (valor de mercado) | amountOriginal (custo)
//
// Proventos (11/09): dividendos/JCP/rendimento não vêm nesse payload — vêm
// de GET /investments/{id}/transactions (`type: "INTEREST"`), buscado à
// parte só pra Ação/FII (ver `fetchAndSyncDividends` abaixo). Renda Fixa/
// Fundo/Cripto continuam com `dividends: null` (não é 0 fake, é "não se
// aplica" — não fazia sentido gastar uma chamada extra da Pluggy por
// posição pra um tipo que o Luiz nem pediu).
//
// Descoberta real (25/08/2026): "CDB de liquidez diária" de conta digital
// (99, e também uma conta específica do BTG) não aparece em GET /investments
// — a Pluggy nem sempre modela isso como um Investment separado. O saldo de
// verdade vem em GET /accounts, campo `bankData.automaticallyInvestedBalance`
// da conta BANK. Sem isso, a posição ficava congelada num valor manual
// antigo pra sempre (nunca tinha uma fonte automática pra "graduar" — ver
// activePositions.ts). Por isso `syncBrokerInvestments` busca as duas coisas.

import { prisma } from "../prisma.js";
import { getInvestments, getAccounts, getAllInvestmentTransactions } from "./pluggy.js";
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

// ERRO corrigido (08/09): cheguei a tratar C6 e Sofisa inteiros como "conta
// corrente" achando que o produto deles não separa saldo parado de
// investimento — Luiz corrigiu: os dois TÊM investimento de verdade (CDB
// com custo de aquisição rastreado, `amountOriginal` real) igual qualquer
// outra corretora. Confirmado ao vivo: a conta BANK dos dois está zerada
// (`automaticallyInvestedBalance: 0`) — não existe saldo de conta corrente
// de verdade pra nenhum dos dois agora. Sem exceção por corretora aqui:
// FIXED_INCOME sempre "Renda Fixa" pra todo mundo; a fatia real de conta
// corrente (quando existir) já é capturada separadamente mais abaixo, via
// `accounts.bankData.automaticallyInvestedBalance` — igual funciona pro
// BTG hoje.
function mapSecurityType(inv: PluggyInvestment): string {
  const tickerPrefix = inv.code?.replace(/[0-9]+$/, "");
  if (tickerPrefix && KNOWN_FII_PREFIXES.has(tickerPrefix)) return "FII";
  if (inv.subtype === "REAL_ESTATE_FUND") return "FII";
  if (inv.subtype === "STOCK" || inv.type === "EQUITY") return "Ação";
  if (inv.type === "FIXED_INCOME") return "Renda Fixa";
  if (inv.type === "MUTUAL_FUND" || inv.type === "ETF") return "Fundo";
  return "Outro";
}

/** Soma proventos (type: "INTEREST") de uma posição por mês/ano, a partir do
 * extrato COMPLETO da Pluggy (não só o mês corrente) — usado só pra Ação/FII
 * (Renda Fixa/Fundo/Cripto não têm esse conceito, ver nota no topo do
 * arquivo). Uma chamada extra da Pluggy por posição; erro nela (ex: rate
 * limit) não pode derrubar o sync do resto da carteira — devolve `null`
 * nesse caso (o chamador decide o que fazer, ver `fetchAndSyncDividends`). */
async function fetchDividendsByMonth(investmentId: string): Promise<Map<string, number> | null> {
  try {
    const transactions = await getAllInvestmentTransactions(investmentId);
    const byMonth = new Map<string, number>(); // chave "ano-mês", ex: "2026-9"
    for (const t of transactions) {
      if (t.type !== "INTEREST") continue;
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + (t.netAmount ?? t.amount));
    }
    return byMonth;
  } catch (err) {
    console.error(`[pluggySync] falha ao buscar proventos de ${investmentId}:`, err);
    return null;
  }
}

/** Busca o extrato completo de uma posição e:
 * 1) PREENCHE RETROATIVAMENTE o `dividends` de todo `PositionSnapshot` já
 *    existente dessa posição (`updateMany` — só toca snapshot que já existe,
 *    nunca cria um novo) — sem isso, o gráfico "proventos por mês" só teria
 *    barra a partir de hoje, quando essa feature nasceu (11/09), mesmo a
 *    Pluggy já tendo o histórico completo desde sempre.
 * 2) Devolve o valor do mês/ano pedido (o que está sendo sincronizado agora),
 *    pro chamador incluir no upsert principal (que pode ser um `create`, se
 *    a posição for nova — updateMany não cobre esse caso).
 * `undefined` em erro (Prisma trata como "não mexe nesse campo" no upsert),
 * nunca `null` fake por cima de um provento já coletado num sync anterior. */
async function fetchAndSyncDividends(
  brokerId: string,
  securityId: string,
  investmentId: string,
  month: number,
  year: number
): Promise<number | undefined> {
  const byMonth = await fetchDividendsByMonth(investmentId);
  if (byMonth === null) return undefined;
  await Promise.all(
    [...byMonth.entries()].map(([key, total]) => {
      const [y, m] = key.split("-").map(Number);
      if (m === month && y === year) return Promise.resolve(); // esse mês entra pelo upsert principal, não aqui
      return prisma.positionSnapshot.updateMany({ where: { brokerId, securityId, month: m, year: y }, data: { dividends: total } });
    })
  );
  return byMonth.get(`${year}-${month}`) ?? 0;
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
    const secType = mapSecurityType(inv);
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
        type: secType,
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
        type: secType,
        currency,
        isin: inv.isin ?? null,
        issuer: inv.issuer ?? null,
        dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
        fixedAnnualRate: inv.fixedAnnualRate ?? null,
        ratePeriodicity: inv.ratePeriodicity ?? null,
      },
    });

    // A Pluggy só manda `amountOriginal` (custo de aquisição de verdade) pra
    // Renda Fixa — confirmado 25/08. Pra Ação/FII ela não manda NADA disso.
    //
    // Achado real (05/09, 2ª rodada): o fix original daqui checava também
    // `inv.amount != null` como sinal de "tem dado real" — só que `amount`
    // NUNCA é null, pra NENHUM tipo de ativo, e não é custo em nenhum dos
    // dois casos: pra Ação/FII ele é sempre EXATAMENTE igual a `balance`
    // (confirmado ao vivo: PETR4/VALE3/ITUB4/AXIA3/CPLE3 têm amount===balance
    // sempre), e pra Renda Fixa ele é outro número calculado (não bate nem
    // com `amountOriginal` nem com `balance` — parece valor bruto antes de
    // IR/IOF). Com o check antigo, `hasRealInvestedAmount` dava sempre true
    // pra Ação/FII (porque `amount` "existia"), reintroduzindo o MESMO bug
    // que esse trecho existe pra evitar, na primeira sincronização manual
    // depois do fix (ainda não tinha acontecido — pego a tempo).
    // Agora só confia em `amountOriginal` de Renda Fixa; sem isso, herda o
    // investido do snapshot anterior em vez de resetar — mesma regra já
    // usada pro CDB embutido de conta corrente e pra cripto on-chain.
    const hasRealInvestedAmount = inv.type === "FIXED_INCOME" && inv.amountOriginal != null;
    // `balance`, não `amount`, era o que eu usava aqui até 08/09 — bug real
    // confirmado pelo Luiz comparando com o app de verdade do BTG: o Tesouro
    // Selic 2029 mostrava R$55.860 pra nós (soma de `balance`), R$58.029,97
    // no BTG (bate com `amount`, R$58.000 — a diferença é só o rendimento de
    // algumas horas entre a conferência dele e minha consulta). Conferido em
    // TODA posição de Renda Fixa ativa de BTG/C6/Sofisa: `balance` fica
    // sistematicamente abaixo de `amount` (0,6% a 3,6%, sempre no mesmo
    // sentido — subestimando o patrimônio em ~R$6.500 no total daquele dia).
    // Pra Ação/FII `amount` já era sempre === `balance` (comentário acima,
    // 05/09), então trocar aqui não muda nada pra eles — só corrige Renda
    // Fixa, que é onde `balance` e `amount` de fato divergiam.
    const marketValue = convert(inv.amount ?? inv.balance);
    let investedAmount: number;
    if (hasRealInvestedAmount) {
      investedAmount = convert(inv.amountOriginal!);
    } else {
      const previous = await prisma.positionSnapshot.findFirst({
        where: { brokerId: broker.id, securityId: security.id },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      });
      investedAmount = previous?.investedAmount ?? marketValue;
    }
    const monthlyRatePct = inv.lastMonthRate ?? null;
    const annualRatePct = inv.lastTwelveMonthsRate ?? null;
    const quantity = inv.quantity ?? null;
    const unitValue = inv.value ?? null;
    // Proventos só fazem sentido pra Ação/FII (pedido do Luiz, 11/09) — pra
    // Renda Fixa/Fundo/Cripto fica null ("não se aplica"), sem gastar uma
    // chamada extra da Pluggy por posição à toa. `undefined` (erro pontual
    // na chamada) preserva o que já tinha sido gravado num sync anterior
    // desse mesmo mês — ver `fetchAndSyncDividends` (que também preenche
    // retroativamente todo mês anterior já sincronizado, pro gráfico "por
    // mês do ano" ter histórico completo desde o primeiro dia da feature).
    const dividends: number | null | undefined =
      secType === "Ação" || secType === "FII" ? await fetchAndSyncDividends(broker.id, security.id, inv.id, month, year) : null;

    await prisma.positionSnapshot.upsert({
      where: {
        brokerId_securityId_month_year: {
          brokerId: broker.id,
          securityId: security.id,
          month,
          year,
        },
      },
      update: { investedAmount, marketValue, fxRateToBRL: fxRate, monthlyRatePct, annualRatePct, quantity, unitValue, dividends },
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
        dividends,
      },
    });
  }

  // Saldo em conta embutido — não vem em /investments, vem em /accounts (ver
  // nota no topo do arquivo). Cada conta BANK com esse campo > 0 vira sua
  // própria posição "Conta Corrente" (nome corrigido, 08/09 — antes chamava
  // "CDB - Liquidez Diária", nome de produto que não existe pra quem usa:
  // pedido do Luiz, "chama de conta corrente apenas"). Tipo "Conta Corrente"
  // (não "Renda Fixa") — esse saldo é dinheiro parado, nunca uma escolha de
  // investir (mesmo raciocínio da Wise, que já tinha o comentário "é
  // liquidez, não investimento" desde 01/09). Universal — cobre 99 e a
  // fatia "conta corrente" do BTG (que também TEM investimento de verdade
  // misturado junto, por isso o resto da carteira dele não muda, só essa
  // linha específica).
  const { results: accounts } = (await getAccounts(itemId)) as { results: PluggyAccount[] };
  let autoInvestCount = 0;
  for (const acc of accounts) {
    const autoInvested = acc.bankData?.automaticallyInvestedBalance;
    if (autoInvested == null || autoInvested <= 0) continue;

    const securityId = `pluggy:autoinvest:${acc.id}`;
    const currency = acc.currencyCode ?? "BRL";
    const security = await prisma.security.upsert({
      where: { id: securityId },
      update: { name: "Conta Corrente", type: "Conta Corrente", currency },
      create: { id: securityId, name: "Conta Corrente", type: "Conta Corrente", currency },
    });

    // Conta corrente não tem "quanto investi" separado de "quanto vale hoje"
    // — não existe cota, preço ou custo de aquisição, só o saldo (pedido do
    // Luiz, 08/09: "ali a dinâmica vai ser diferente... não existe cotas,
    // preço, investido"). Por isso investedAmount SEMPRE acompanha o saldo
    // atual (nunca herda um valor congelado do snapshot anterior, diferente
    // de Renda Fixa/Ação/FII) — sem isso, todo depósito/saque virava
    // "rentabilidade" falsa no ReturnBadge, quando na real é só dinheiro
    // entrando ou saindo, não retorno de investimento.
    await prisma.positionSnapshot.upsert({
      where: { brokerId_securityId_month_year: { brokerId: broker.id, securityId: security.id, month, year } },
      update: { investedAmount: autoInvested, marketValue: autoInvested },
      create: { brokerId: broker.id, securityId: security.id, month, year, investedAmount: autoInvested, marketValue: autoInvested },
    });
    autoInvestCount++;
  }

  await prisma.broker.update({
    where: { id: broker.id },
    data: { lastSyncedAt: now },
  });

  return { count: results.length + autoInvestCount, investmentsCount: results.length, autoInvestCount, month, year };
}
