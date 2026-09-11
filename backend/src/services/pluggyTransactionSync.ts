// Sync real de transação de cartão de crédito via Pluggy (31/08), estendido
// (07/09) pra também trazer Pix de conta BANK (99, corrente do BTG etc.).
//
// Confirmado em teste real (30/08): GET /v2/transactions?accountId= devolve
// creditCardMetadata.{installmentNumber,totalInstallments,billForecastDate}
// quando a compra é parcelada — é exatamente o dado que faltava pra
// automatizar o que vínhamos fazendo à mão (bater fatura da Caixa).
//
// REGRA TRAVADA (01/09, ainda vale pro Pix): Luiz faz muita transferência
// entre as próprias contas (BTG <-> C6, recebimento de cliente que passa
// pela conta corrente antes de ir pra outro lugar etc.) — uma entrada de
// dinheiro na conta corrente NUNCA pode virar `Transaction.type: "income"`
// automaticamente só por ter chegado lá. "Entrada" só existe quando ele
// lança manualmente (via POST /transactions ou um fluxo ligado a Projetos).
// Por isso o Pix (ver syncPixFromBankAccounts abaixo) só grava SAÍDA
// (DEBIT) pra outra pessoa/empresa — Pix recebido de qualquer origem, e
// Pix "de mim pra mim" (mesma pessoa como payer e receiver, comum entre
// contas próprias), nunca vira Transaction — nem como transferência, nem
// como receita, pra não sujar o histórico com ruído que não importa.
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
  // Só vem em transação de conta BANK (Pix, TED, boleto...) — confirmado com
  // dado real (07/09) que `paymentData.receiver.name` só existe quando o
  // destinatário é empresa (CNPJ); pra pessoa física (CPF) vem só o
  // documento, sem nome.
  operationType?: string | null; // "PIX" | outros
  paymentData?: {
    payer?: { documentNumber?: { type: string; value: string } | null } | null;
    receiver?: { documentNumber?: { type: string; value: string } | null; name?: string | null } | null;
  } | null;
}

/** Valor real gasto em reais — usa a conversão da Pluggy quando ela existe
 * (transação em moeda estrangeira), senão cai pro `amount` puro (já é BRL). */
function realAmount(tx: PluggyTransaction): number {
  return tx.amountInAccountCurrency ?? tx.amount;
}

/** Marca a Transaction como parcela de compra parcelada (pedido do Luiz,
 * 08/09: "deixa marcado que é uma compra parcelada") — direto do
 * creditCardMetadata que a Pluggy já manda, sem precisar de nenhum cálculo
 * extra. `installmentNumber` é especificamente a parcela DESSA transação (a
 * que já aconteceu); null pra compra à vista. */
function installmentFields(tx: PluggyTransaction): { installmentNumber: number | null; totalInstallments: number | null } {
  const meta = tx.creditCardMetadata;
  return {
    installmentNumber: meta?.installmentNumber ?? null,
    totalInstallments: meta?.totalInstallments ?? null,
  };
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

// Removido o mapeamento de categoria da Pluggy (07/09, pedido do Luiz): o
// banco não sabe de verdade do que se trata a compra (achado real — mandou
// "Taxi and ride-hailing" pra uma pamonha, "MP *CLARISSYLAYAN"), e essa tag
// tinha PRIORIDADE sobre a `CategorizationRule` que o próprio Luiz confirma
// à mão — ou seja, uma correção dele podia ser revertida pela Pluggy no
// próximo sync. Agora a única fonte de categoria automática é
// `suggestCategory` (nossas regras, construídas a partir do que o Luiz
// mesmo já categorizou) — sem regra ainda, fica sem categoria (nunca chuta
// pela tag do banco).
async function resolveCategoryId(tx: PluggyTransaction): Promise<string | null> {
  const suggested = await suggestCategory(tx.description);
  return suggested?.id ?? null;
}

// "Pix pra mim mesmo" (entre contas próprias) — mesmo documento (CPF/CNPJ)
// como payer E receiver na mesma transação. Funciona pra QUALQUER banco
// conectado, sem guardar CPF/CNPJ do Luiz em lugar nenhum do código — a
// Pluggy já resolve os dois lados, só comparar. Sem documento de um dos
// dois lados (raro, mas achado real: alguns Pix pra pessoa física vêm sem
// documentNumber nenhum), trata como "não dá pra confirmar que é de
// terceiro" e ignora por segurança — melhor perder um Pix real do que
// sujar o histórico com um que na verdade era transferência própria.
function isPixToThirdParty(tx: PluggyTransaction): boolean {
  const payerDoc = tx.paymentData?.payer?.documentNumber?.value;
  const receiverDoc = tx.paymentData?.receiver?.documentNumber?.value;
  if (!payerDoc || !receiverDoc) return false;
  return payerDoc !== receiverDoc;
}

// Nome do destinatário (só vem quando é CNPJ — confirmado com dado real,
// 07/09) vira a descrição, no lugar do texto genérico "pix key transfer" /
// "pix qr transfer" que a Pluggy manda — sem isso, toda CategorizationRule
// de Pix cairia no mesmo texto genérico e nunca aprenderia por comerciante
// de verdade (mesmo motivo que já vale pra descrição de compra de cartão).
function pixDescription(tx: PluggyTransaction): string {
  const receiver = tx.paymentData?.receiver;
  if (receiver?.name?.trim()) return receiver.name.trim();
  if (receiver?.documentNumber) return `Pix para ${receiver.documentNumber.type} ${receiver.documentNumber.value}`;
  return tx.description;
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
  const bankAccounts = accounts.filter((a) => a.type === "BANK");

  let transactionsSynced = 0;
  let transactionsSkipped = 0;
  let transactionsReconciled = 0;
  let installmentsCreated = 0;
  let categorizedCount = 0;
  let pixSynced = 0;
  let pixIgnored = 0; // recebido, ou pra mim mesmo, ou sem documento do destinatário

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
              ...installmentFields(tx),
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
            ...installmentFields(tx),
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
          ...installmentFields(tx),
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

  // Pix (07/09, pedido do Luiz: "vamos implementar trazer o pix de todos os
  // bancos"). Só SAÍDA (DEBIT) pra terceiro de verdade — ver isPixToThirdParty
  // e a nota travada no topo do arquivo sobre nunca inferir receita daqui.
  for (const account of bankAccounts) {
    const { results: transactions } = (await getTransactions(account.id)) as { results: PluggyTransaction[] };

    for (const tx of transactions) {
      if (tx.operationType !== "PIX" || tx.type !== "DEBIT") continue;
      if (!isPixToThirdParty(tx)) {
        pixIgnored++;
        continue;
      }

      const externalId = `pluggy:${tx.id}`;
      const existing = await prisma.transaction.findUnique({ where: { externalId } });
      if (existing) continue; // já sincronizado antes, nada a fazer (Pix não tem estado PENDING pra reconciliar)

      const description = pixDescription(tx);
      const amount = Math.abs(realAmount(tx));

      // Mesmo lançamento manual adiantado + reconciliação já usado pra
      // cartão (ver findAwaitingMatch acima) — é literalmente o caso que
      // motivou o pedido: "Faxina"/"Hotel em Natal" lançados na hora,
      // confirmados aqui quando o Pix de verdade aparece.
      const manualMatch = await findAwaitingMatch(broker.id, amount, new Date(tx.date));
      if (manualMatch) {
        await prisma.transaction.update({
          where: { id: manualMatch.id },
          data: { date: new Date(tx.date), description, amount, externalId, awaitingPluggyMatch: false },
        });
        pixSynced++;
        continue;
      }

      const categoryId = (await suggestCategory(description))?.id ?? null;
      await prisma.transaction.create({
        data: {
          date: new Date(tx.date),
          type: "expense",
          description,
          amount,
          source: "pluggy",
          externalId,
          isTransfer: false,
          categoryId,
          brokerId: broker.id,
        },
      });
      pixSynced++;
    }
  }

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: new Date() } });

  return { transactionsSynced, transactionsSkipped, transactionsReconciled, installmentsCreated, categorizedCount, pixSynced, pixIgnored };
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
    pixSynced: number;
    pixIgnored: number;
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
        pixSynced: 0,
        pixIgnored: 0,
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
      pixSynced: acc.pixSynced + r.pixSynced,
      pixIgnored: acc.pixIgnored + r.pixIgnored,
    }),
    { transactionsSynced: 0, transactionsSkipped: 0, transactionsReconciled: 0, installmentsCreated: 0, categorizedCount: 0, pixSynced: 0, pixIgnored: 0 }
  );

  return { ...totals, perBroker };
}
