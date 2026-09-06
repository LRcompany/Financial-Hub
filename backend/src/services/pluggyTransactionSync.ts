// Sync real de transação de cartão de crédito via Pluggy (31/08). Escopo
// hoje: só conta CREDIT (o pedido do Luiz foi especificamente "cartão de
// crédito") — conta BANK (99, corrente do BTG etc.) fica pra uma próxima
// rodada, não é o mesmo formato de dado (sem parcelamento).
//
// Confirmado em teste real (30/08): GET /v2/transactions?accountId= devolve
// creditCardMetadata.{installmentNumber,totalInstallments,billForecastDate}
// quando a compra é parcelada — é exatamente o dado que faltava pra
// automatizar o que vínhamos fazendo à mão (bater fatura da Caixa).
//
// REGRA TRAVADA (01/09), vale pra quando essa rodada de conta BANK for
// implementada: Luiz faz muita transferência entre as próprias contas (BTG
// <-> C6, recebimento de cliente que passa pela conta corrente antes de ir
// pra outro lugar etc.) — uma entrada de dinheiro na conta corrente NUNCA
// pode virar `Transaction.type: "income"` automaticamente só por ter
// chegado lá. "Entrada" só existe quando ele lança manualmente ("recebi R$X
// no dia Y", via POST /transactions ou um fluxo equivalente ligado a
// Projetos) — o sync de conta BANK, quando existir, deve gravar a
// movimentação (se gravar) sempre como transferência (isTransfer: true),
// nunca como receita inferida.
import { prisma } from "../prisma.js";
import { getAccounts, getTransactions } from "./pluggy.js";
import { suggestCategory } from "./categorization.js";

interface PluggyAccountRaw {
  id: string;
  type: string;
  name: string;
}

interface PluggyTransaction {
  id: string;
  description: string;
  // `amount` é no valor ORIGINAL da transação — pra compra internacional
  // (Google Workspace, Claude, qualquer assinatura em dólar) isso é o valor
  // em USD, NÃO o que realmente saiu do cartão em reais. `currencyCode`
  // avisa a moeda; `amountInAccountCurrency` é o valor JÁ convertido pra
  // reais (04/09: achado com dado real — Google Workspace guardava US$7,00
  // quando o valor real cobrado era R$38,17; acontecia com TODA transação
  // em moeda estrangeira, 13 meses seguidos, nunca só uma). Pra gravar
  // gasto de verdade usa sempre `realAmount()`, nunca `tx.amount` puro.
  amount: number;
  currencyCode?: string | null;
  amountInAccountCurrency?: number | null;
  date: string;
  type: string; // DEBIT | CREDIT
  status: string; // PENDING | POSTED
  category: string | null;
  creditCardMetadata?: {
    cardNumber?: string | null;
    totalInstallments?: number | null;
    installmentNumber?: number | null;
    billForecastDate?: string | null; // "YYYY-MM"
  } | null;
}

/** Valor real gasto em reais — usa a conversão da Pluggy quando ela existe
 * (transação em moeda estrangeira), senão cai pro `amount` puro (já é BRL). */
function realAmount(tx: PluggyTransaction): number {
  return tx.amountInAccountCurrency ?? tx.amount;
}

// Cobrança que SEMPRE vem acompanhada do estorno correspondente no mesmo
// ciclo — confirmado com o Luiz (04/09): "Tarifa Anuidade Diferenciada" do
// C6 é cobrada e estornada todo mês por causa do investimento dele lá, sempre
// se anula. Mesmo sendo DEBIT (cobrança de verdade, não CREDIT/estorno), não
// deve contar como gasto — mostra no histórico normalmente, só não entra em
// nenhum cálculo (meta diária, orçamento por categoria). Comparação por
// "contains" (case-insensitive), não igualdade exata, pra resistir a
// pequena variação de sufixo que o banco às vezes manda.
const ALWAYS_TRANSFER_DESCRIPTION_PATTERNS = ["tarifa anuidade diferenciada"];

function isSelfCancelingCharge(description: string): boolean {
  const normalized = description.toLowerCase();
  return ALWAYS_TRANSFER_DESCRIPTION_PATTERNS.some((p) => normalized.includes(p));
}

// Ideia do Luiz (06/09): lançar a compra manualmente assim que acontece (já
// conta no orçamento na hora, sem esperar o atraso da Pluggy) e deixar esse
// sync casar com a transação real quando ela chegar. Janela de 10 dias pra
// cada lado (a Pluggy às vezes leva vários dias pra postar a compra na
// fatura) e tolerância de 1 centavo de arredondamento no valor — o valor é o
// sinal forte do match, a data só limita falso-positivo de compra parecida
// em outro mês. Quando tem mais de um candidato (raro: 2 compras do mesmo
// valor no mesmo período), pega o de data mais próxima.
const MATCH_WINDOW_DAYS = 10;
const MATCH_AMOUNT_TOLERANCE = 0.01;

async function findAwaitingMatch(brokerId: string, amount: number, date: Date) {
  const windowStart = new Date(date);
  windowStart.setDate(windowStart.getDate() - MATCH_WINDOW_DAYS);
  const windowEnd = new Date(date);
  windowEnd.setDate(windowEnd.getDate() + MATCH_WINDOW_DAYS);

  const candidates = await prisma.transaction.findMany({
    where: {
      brokerId,
      awaitingPluggyMatch: true,
      amount: { gte: amount - MATCH_AMOUNT_TOLERANCE, lte: amount + MATCH_AMOUNT_TOLERANCE },
      date: { gte: windowStart, lte: windowEnd },
    },
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.date.getTime() - date.getTime()) - Math.abs(b.date.getTime() - date.getTime()));
  return candidates[0];
}

// Mapeamento conservador: só categoria da Pluggy que a gente já viu de
// verdade numa transação real e que bate SEM ambiguidade com uma folha
// nossa. Categoria da Pluggy sem entrada aqui fica null (melhor sem
// categoria do que categoria chutada) — expandir conforme for aparecendo
// mais transação real pra conferir contra.
const PLUGGY_CATEGORY_MAP: Record<string, [string, string]> = {
  "Taxi and ride-hailing": ["Transporte", "Uber, 99"],
};

async function findLeafCategoryId(path: [string, string] | [string, string, string]): Promise<string | null> {
  let parentId: string | null = null;
  let found = null;
  for (const name of path) {
    found = await prisma.category.findFirst({ where: { name, parentId } });
    if (!found) return null;
    parentId = found.id;
  }
  return found?.id ?? null;
}

async function resolveCategoryId(tx: PluggyTransaction): Promise<string | null> {
  if (tx.category && PLUGGY_CATEGORY_MAP[tx.category]) {
    const id = await findLeafCategoryId(PLUGGY_CATEGORY_MAP[tx.category]);
    if (id) return id;
  }
  const suggested = await suggestCategory(tx.description);
  return suggested?.id ?? null;
}

/** Último dia válido de um mês (28-31) — pra não estourar pro mês seguinte
 * projetando "dia 31" num mês de 30 dias (ex: `new Date(y, 1, 31)` vira 3 de
 * março, não fevereiro). */
function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** dueDate N meses depois de billForecastDate ("YYYY-MM"), no MESMO dia do
 * mês da parcela mais recente (`anchorDay`) — não sempre dia 1. Confirmado
 * com dado real (04/09): a parcela da Usina Solar vence sempre por volta do
 * dia 21-22, nunca no dia 1; "dia 1 sempre" foi o bug que fazia toda parcela
 * futura de qualquer compra aparecer com o mesmo vencimento errado em
 * "Comprometido em parcelas futuras". */
function futureDueDate(billForecastDate: string, monthsAhead: number, anchorDay: number): Date {
  const [y, m] = billForecastDate.split("-").map(Number);
  const monthIndex0 = m - 1 + monthsAhead;
  const day = Math.min(anchorDay, lastDayOfMonth(y, monthIndex0));
  return new Date(y, monthIndex0, day);
}

export async function syncBrokerCreditCardTransactions(brokerId: string, itemId: string) {
  const broker = await prisma.broker.findUniqueOrThrow({ where: { id: brokerId } });

  const { results: accounts } = (await getAccounts(itemId)) as { results: PluggyAccountRaw[] };
  const creditAccounts = accounts.filter((a) => a.type === "CREDIT");

  let transactionsSynced = 0;
  let transactionsSkipped = 0;
  let transactionsReconciled = 0;
  let installmentsCreated = 0;
  let categorizedCount = 0;

  for (const account of creditAccounts) {
    const { results: transactions } = (await getTransactions(account.id)) as { results: PluggyTransaction[] };

    // Passo 1: grava cada transação real — a Pluggy devolve UMA por mês de
    // fatura pra compra parcelada (é a cobrança daquele mês, aconteceu de
    // verdade), então todas viram Transaction, sem exceção.
    const newlyCreated: { tx: PluggyTransaction; categoryId: string | null }[] = [];
    for (const tx of transactions) {
      const externalId = `pluggy:${tx.id}`;
      const existing = await prisma.transaction.findUnique({ where: { externalId } });
      if (existing) {
        // Transação "PENDING" entra com dado provisório (compra
        // internacional costuma chegar como "MASTERCARD INTERNACIONAL"
        // genérico até o banco confirmar o lojista real). Só revisita
        // enquanto ainda estava marcada pendente da última vez — uma já
        // confirmada (`pluggyPending: false`) nunca é tocada de novo, pra
        // não sobrescrever categoria que o usuário já corrigiu à mão.
        if (existing.pluggyPending && tx.status === "POSTED") {
          const isTransfer = tx.type === "CREDIT" || isSelfCancelingCharge(tx.description);
          // NUNCA sobrescreve uma categoria já definida — "sem categoria"
          // enquanto pendente pode já ter sido corrigida à mão nesse meio
          // tempo (ex: Luiz categoriza toda "MASTERCARD INTERNACIONAL" antes
          // do sync seguinte confirmar o nome real); só resolve categoria
          // nova se ainda estiver null.
          const categoryId = existing.categoryId ?? (await resolveCategoryId(tx));
          await prisma.transaction.update({
            where: { id: existing.id },
            data: {
              date: new Date(tx.date),
              description: tx.description,
              amount: realAmount(tx),
              isTransfer,
              categoryId,
              pluggyPending: false,
            },
          });
          transactionsReconciled++;
        } else {
          transactionsSkipped++;
        }
        continue;
      }

      // CREDIT numa fatura de cartão é pagamento/estorno, não gasto — grava
      // como transferência (mesma lógica já usada pra fatura Caixa→C6), não
      // soma em "quanto gastei". Cobrança que sempre se anula com um estorno
      // (ver isSelfCancelingCharge) também nunca é gasto real, mesmo sendo
      // DEBIT.
      const isTransfer = tx.type === "CREDIT" || isSelfCancelingCharge(tx.description);

      // Antes de criar linha nova, confere se é a confirmação de um
      // lançamento manual feito adiantado (ver findAwaitingMatch) — se for,
      // ATUALIZA em vez de criar (senão a compra conta 2x: a manual +
      // a real). Categoria do lançamento manual NUNCA é sobrescrita (o Luiz
      // já escolheu na hora de lançar).
      const manualMatch = await findAwaitingMatch(broker.id, realAmount(tx), new Date(tx.date));
      if (manualMatch) {
        await prisma.transaction.update({
          where: { id: manualMatch.id },
          data: {
            date: new Date(tx.date),
            description: tx.description,
            amount: realAmount(tx),
            isTransfer,
            externalId,
            awaitingPluggyMatch: false,
            pluggyPending: tx.status === "PENDING",
          },
        });
        transactionsReconciled++;
        // Ainda entra em `newlyCreated` (mesmo sem ser create) — se essa
        // compra confirmada for parcelada, a projeção do passo 2 abaixo
        // precisa dela pra gerar as parcelas futuras normalmente.
        newlyCreated.push({ tx, categoryId: manualMatch.categoryId });
        continue;
      }

      const categoryId = await resolveCategoryId(tx);
      if (categoryId) categorizedCount++;

      await prisma.transaction.create({
        data: {
          date: new Date(tx.date),
          type: "expense",
          description: tx.description,
          amount: realAmount(tx),
          source: "pluggy",
          externalId,
          isTransfer,
          categoryId,
          brokerId: broker.id,
          pluggyPending: tx.status === "PENDING",
        },
      });
      transactionsSynced++;
      newlyCreated.push({ tx, categoryId });
    }

    // Passo 2: projeta parcela futura só a partir da fatura MAIS RECENTE de
    // cada compra parcelada. Cada mês de fatura já vem com sua própria
    // "parcelas restantes a partir daqui" — usar todo mês pra projetar
    // duplicaria pesado (confirmado com dado real: Usina Solar tinha 21
    // faturas mensais, cada uma projetando o restante, virando 179 linhas
    // sobrepostas pra só 19 datas de vencimento distintas). "Mesma compra" =
    // mesma descrição + valor + últimos dígitos do cartão.
    const latestByPurchase = new Map<string, { tx: PluggyTransaction; categoryId: string | null }>();
    for (const entry of newlyCreated) {
      const meta = entry.tx.creditCardMetadata;
      if (!meta?.totalInstallments || !meta?.installmentNumber) continue;
      const key = `${entry.tx.description}|${entry.tx.amount}|${meta.cardNumber ?? ""}`;
      const current = latestByPurchase.get(key);
      const currentNumber = current?.tx.creditCardMetadata?.installmentNumber ?? -1;
      if (meta.installmentNumber > currentNumber) latestByPurchase.set(key, entry);
    }

    for (const { tx, categoryId } of latestByPurchase.values()) {
      const meta = tx.creditCardMetadata!;
      const total = meta.totalInstallments!;
      const current = meta.installmentNumber!;
      const forecast = meta.billForecastDate;
      if (!forecast || total <= current) continue;
      const anchorDay = new Date(tx.date).getDate();
      // Projeção usa o valor REAL (convertido) da parcela mais recente como
      // estimativa das próximas — é a mesma aproximação que já existia,
      // só que agora com o valor certo em reais (não o valor em dólar).
      const projectedAmount = realAmount(tx);
      for (let n = current + 1; n <= total; n++) {
        const installmentExternalId = `pluggy:${tx.id}:${n}`;
        const dueDate = futureDueDate(forecast, n - current, anchorDay);
        await prisma.upcomingInstallment.upsert({
          where: { externalId: installmentExternalId },
          update: { dueDate, description: tx.description, amount: projectedAmount, cardLabel: broker.name, categoryId },
          create: {
            externalId: installmentExternalId,
            dueDate,
            description: tx.description,
            amount: projectedAmount,
            cardLabel: broker.name,
            categoryId,
          },
        });
        installmentsCreated++;
      }
    }
  }

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: new Date() } });

  return { transactionsSynced, transactionsSkipped, transactionsReconciled, installmentsCreated, categorizedCount };
}

/**
 * Roda o sync em TODO broker Pluggy conectado, um de cada vez — reaproveitada
 * pelo botão manual ("Atualizar transações") e pelo agendador automático
 * (scheduler.ts). Erro num broker não trava os outros.
 */
export async function syncAllBrokersCreditCardTransactions() {
  const brokers = await prisma.broker.findMany({ where: { dataSource: "pluggy", pluggyConnectorId: { not: null }, archivedAt: null } });

  const perBroker: {
    broker: string;
    transactionsSynced: number;
    transactionsSkipped: number;
    transactionsReconciled: number;
    installmentsCreated: number;
    categorizedCount: number;
    error?: string;
  }[] = [];

  for (const broker of brokers) {
    try {
      const result = await syncBrokerCreditCardTransactions(broker.id, broker.pluggyConnectorId!);
      perBroker.push({ broker: broker.name, ...result });
    } catch (err) {
      perBroker.push({
        broker: broker.name,
        transactionsSynced: 0,
        transactionsSkipped: 0,
        transactionsReconciled: 0,
        installmentsCreated: 0,
        categorizedCount: 0,
        error: (err as Error).message,
      });
    }
  }

  const totals = perBroker.reduce(
    (acc, r) => ({
      transactionsSynced: acc.transactionsSynced + r.transactionsSynced,
      transactionsSkipped: acc.transactionsSkipped + r.transactionsSkipped,
      transactionsReconciled: acc.transactionsReconciled + r.transactionsReconciled,
      installmentsCreated: acc.installmentsCreated + r.installmentsCreated,
      categorizedCount: acc.categorizedCount + r.categorizedCount,
    }),
    { transactionsSynced: 0, transactionsSkipped: 0, transactionsReconciled: 0, installmentsCreated: 0, categorizedCount: 0 }
  );

  return { ...totals, perBroker };
}
