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
import crypto from "node:crypto";
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
    // Data em que a parcela entrou na fatura ("YYYY-MM-DD") e data da compra
    // original (ISO) — confirmado com dado real do C6 (02/10): toda parcela
    // traz os dois; `billForecastDate` só vem na 1ª parcela de cada compra.
    billPostDate?: string | null;
    purchaseDate?: string | null;
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

// Boleto de consumo pago pela conta corrente (14/09, pedido do Luiz: "o
// boleto do aluguel vem com água, gás, internet e seguro juntos, como
// resolver isso?") — confirmado com dado real de produção que a Pluggy NUNCA
// manda `operationType: "BOLETO"` pra esse débito na conta 99 (só no cartão
// C6); na conta corrente vem como `operationType: "OUTROS"` + `description:
// "br_utility"`, todo mês, valor variando (aluguel + consumo do mês).
// `"OUTROS"` sozinho é um saco de gato genérico — outros bancos (Sofisa)
// usam pra débito de investimento e até Pix mal rotulado — por isso o match
// exige a descrição EXATA junto, nunca só o operationType.
function isUtilityBoleto(tx: PluggyTransaction): boolean {
  return tx.type === "DEBIT" && tx.operationType === "OUTROS" && tx.description === "br_utility";
}

/** Último dia válido de um mês (28-31) — pra não estourar pro mês seguinte
 * projetando "dia 31" num mês de 30 dias (ex: `new Date(y, 1, 31)` vira 3 de
 * março, não fevereiro). */
function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

const dateYmIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** Dia da compra, N meses depois (meio-dia UTC, pra nunca virar o dia
 * vizinho por fuso). Regra do Luiz (02/10): "parcela não é previsão... no
 * cartão mostra o dia da compra e as parcelas" — a parcela N de uma compra
 * feita em 03/07 cai SEMPRE em 03 do mês N−1 depois (1ª 03/07, 2ª 03/08…),
 * não no dia em que o banco lança na fatura (C6 dia 17, BTG dia 21). */
export function purchaseDayPlusMonths(purchaseDate: string, monthsAhead: number): Date {
  const [y, m, d] = purchaseDate.slice(0, 10).split("-").map(Number);
  const monthIndex0 = m - 1 + monthsAhead;
  const yy = y + Math.floor(monthIndex0 / 12);
  const mm = ((monthIndex0 % 12) + 12) % 12;
  return new Date(Date.UTC(yy, mm, Math.min(d, lastDayOfMonth(yy, mm)), 12));
}

/** Data que conta pro gasto. Parcela de compra parcelada (com a data da
 * compra original) = dia da compra no mês da parcela (ver
 * `purchaseDayPlusMonths`); o resto = a data da Pluggy. Cobre de quebra o
 * BTG mandando parcela já cobrada com a data da compra (Usina Solar,
 * parcelas 2–4 datadas 03/02/2026). */
export function effectiveDate(tx: PluggyTransaction): Date {
  const meta = tx.creditCardMetadata;
  if (meta?.purchaseDate && meta.installmentNumber && meta.totalInstallments && meta.totalInstallments > 1) {
    return purchaseDayPlusMonths(meta.purchaseDate, meta.installmentNumber - 1);
  }
  return new Date(tx.date);
}

/** Parcela de mês FUTURO (02/10): o BTG manda as parcelas ainda não
 * cobradas como transação (Usina Solar: parcelas 10 a 21 já existem na
 * Pluggy). Gasto de mês que ainda não chegou não vira Transaction — já
 * aparece como parcela do mês dela (UpcomingInstallment). Vira Transaction
 * no mês em que cai. */
export function isFutureBilled(tx: PluggyTransaction, now = new Date()): boolean {
  return dateYmIndex(effectiveDate(tx)) > now.getUTCFullYear() * 12 + now.getUTCMonth();
}

// ---------- Parcelas futuras: plano puro + reconciliação (27/10) ----------
// Reescrito depois do 3º bug de parcela em um mês (falta de projeção sem
// `billForecastDate`, duplicação por grupo errado, duplicação por fuso). O
// desenho antigo ia REMENDANDO linhas a partir de "a parcela mais recente"
// e cada caso novo da Pluggy deixava linha órfã ou repetida. Agora:
//   1. `planInstallments` (função PURA, testada) diz, só a partir das
//      transações da Pluggy, quais parcelas futuras DEVEM existir — cada
//      uma com um código fixo `pluggy:p:<compra>:<n>`.
//   2. `reconcileInstallments` faz o banco ficar IGUAL ao plano, por
//      corretora: cria o que falta, atualiza o que mudou, apaga o que sobra
//      (inclusive linhas do formato antigo `pluggy:<txId>:<n>`), levando
//      junto nota/categoria/total que o Luiz editou.
// Duplicata vira impossível por construção: um código por compra+parcela.

export type PlannedInstallment = {
  externalId: string;
  purchaseKey: string;
  n: number;
  total: number;
  dueDate: Date;
  amount: number;
  description: string;
  sourceTxIds: string[]; // todas as transações da Pluggy dessa compra
  latestTxId: string;
};

// Dia (em São Paulo, UTC−3) de uma data ISO — chave estável da compra mesmo
// quando a Pluggy manda a hora com 3h de fuso a mais (C6, out/26).
function spDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Agrupa as parcelas da Pluggy por compra. "Mesma compra" = descrição +
 * final do cartão + total de parcelas + data da compra a até 36h (o BTG varia
 * milissegundos; o C6 mandou 3h de fuso numa fatura). Sem data da compra, o
 * valor entra na chave. Exportada pros testes. */
export function groupPurchases(transactions: PluggyTransaction[], now = new Date()): PluggyTransaction[][] {
  const CLUSTER_MS = 36 * 60 * 60 * 1000;
  const buckets = new Map<string, PluggyTransaction[]>();
  for (const tx of transactions) {
    const meta = tx.creditCardMetadata;
    if (!meta?.totalInstallments || !meta?.installmentNumber || meta.totalInstallments < 2) continue;
    if (tx.type === "CREDIT" || tx.amount < 0) continue;
    if (isFutureBilled(tx, now)) continue; // parcela de mês futuro não é "a mais recente lançada"
    const key = `${tx.description}|${meta.cardNumber ?? ""}|${meta.totalInstallments}${meta.purchaseDate ? "" : `|${tx.amount}`}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(tx);
  }
  const groups: PluggyTransaction[][] = [];
  for (const list of buckets.values()) {
    const sorted = [...list].sort((x, y) => (x.creditCardMetadata?.purchaseDate ?? "").localeCompare(y.creditCardMetadata?.purchaseDate ?? ""));
    let current: PluggyTransaction[] = [];
    let anchor: number | null = null;
    for (const tx of sorted) {
      const pd = tx.creditCardMetadata?.purchaseDate;
      const t = pd ? new Date(pd).getTime() : null;
      if (current.length > 0 && t != null && anchor != null && t - anchor > CLUSTER_MS) {
        groups.push(current);
        current = [];
        anchor = null;
      }
      current.push(tx);
      if (anchor == null && t != null) anchor = t;
    }
    if (current.length > 0) groups.push(current);
  }
  return groups;
}

/** Plano PURO das parcelas futuras de um cartão: pra cada compra, as parcelas
 * depois da mais recente já lançada, cada uma no dia da compra do mês dela.
 * - Compra estornada (CREDIT com mesma descrição/valor no dia da compra) não
 *   tem parcela futura.
 * - Nunca planeja parcela antes do mês PASSADO (mês mais antigo já tem o
 *   dado real; uma projeção lá só duplicaria gasto). */
export function planInstallments(transactions: PluggyTransaction[], brokerId: string, now = new Date()): PlannedInstallment[] {
  const oldestDue = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const refunds = new Set(
    transactions
      .filter((t) => t.type === "CREDIT" || t.amount < 0)
      .map((t) => `${t.description}|${Math.abs(t.amount).toFixed(2)}|${t.date.slice(0, 10)}`)
  );
  const planned: PlannedInstallment[] = [];
  for (const txs of groupPurchases(transactions, now)) {
    const latest = txs.reduce((a, b) => {
      const na = a.creditCardMetadata!.installmentNumber!;
      const nb = b.creditCardMetadata!.installmentNumber!;
      return nb > na || (nb === na && b.date > a.date) ? b : a;
    });
    const meta = latest.creditCardMetadata!;
    const total = meta.totalInstallments!;
    const current = meta.installmentNumber!;
    if (current >= total) continue;
    const purchaseDay = (meta.purchaseDate ?? latest.date).slice(0, 10);
    if (refunds.has(`${latest.description}|${Math.abs(latest.amount).toFixed(2)}|${purchaseDay}`)) continue;
    const anchorDay = meta.purchaseDate ? spDay(meta.purchaseDate) : spDay(effectiveDate(latest).toISOString());
    const purchaseKey = crypto
      .createHash("sha1")
      .update(`${brokerId}|${latest.description}|${meta.cardNumber ?? ""}|${total}|${anchorDay}`)
      .digest("hex")
      .slice(0, 16);
    const latestDate = effectiveDate(latest);
    for (let n = current + 1; n <= total; n++) {
      const dueDate = meta.purchaseDate ? purchaseDayPlusMonths(meta.purchaseDate, n - 1) : purchaseDayPlusMonths(latestDate.toISOString(), n - current);
      if (dueDate < oldestDue) continue;
      planned.push({
        externalId: `pluggy:p:${purchaseKey}:${n}`,
        purchaseKey,
        n,
        total,
        dueDate,
        amount: realAmount(latest),
        description: latest.description,
        sourceTxIds: txs.map((t) => t.id),
        latestTxId: latest.id,
      });
    }
  }
  return planned;
}

/** Deixa as parcelas futuras da Pluggy de UMA corretora iguais ao plano.
 * Recebe as transações de TODAS as contas de cartão da corretora de uma vez
 * (senão uma conta apagaria as parcelas da outra). Nunca toca em parcela
 * manual (sem `externalId` — ex.: cartão Caixa, digitado). */
export async function reconcileInstallments(
  transactions: PluggyTransaction[],
  broker: { id: string; name: string },
  { dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}
): Promise<{ created: number; updated: number; deleted: number; log: string[] }> {
  const log: string[] = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;
  const plan = planInstallments(transactions, broker.id, now);

  const existing = await prisma.upcomingInstallment.findMany({
    where: { cardLabel: broker.name, externalId: { startsWith: "pluggy:" } },
  });
  // Trava de segurança: lista da Pluggy sem nenhuma parcela, mas com parcelas
  // gravadas = resposta incompleta da Pluggy, não "todas as compras acabaram".
  const hasInstallmentData = transactions.some((t) => (t.creditCardMetadata?.totalInstallments ?? 0) > 1);
  if (!hasInstallmentData && existing.length > 0) {
    log.push(`pula   ${broker.name}: Pluggy sem nenhuma parcela nesta resposta — nada apagado`);
    return { created, updated, deleted, log };
  }

  // Linha antiga (`pluggy:<txId>:<n>`) → compra do plano, via a transação de origem.
  const purchaseOfTx = new Map<string, string>();
  for (const p of plan) for (const id of p.sourceTxIds) purchaseOfTx.set(id, p.purchaseKey);
  const legacyKey = (u: (typeof existing)[number]) => {
    const parts = u.externalId!.split(":");
    if (parts[1] === "p") return `${parts[2]}:${parts[3]}`;
    const pk = purchaseOfTx.get(parts[1]);
    return pk ? `${pk}:${parts[2]}` : null;
  };

  // Categoria de cada compra: a da parcela lançada mais recente que tenha uma.
  const allSourceIds = [...new Set(plan.flatMap((p) => p.sourceTxIds))].map((id) => `pluggy:${id}`);
  const posted = allSourceIds.length
    ? await prisma.transaction.findMany({
        where: { externalId: { in: allSourceIds } },
        select: { externalId: true, categoryId: true, date: true },
        orderBy: { date: "desc" },
      })
    : [];
  const categoryOfPurchase = new Map<string, string>();
  for (const t of posted) {
    const pk = purchaseOfTx.get(t.externalId!.slice("pluggy:".length));
    if (pk && t.categoryId && !categoryOfPurchase.has(pk)) categoryOfPurchase.set(pk, t.categoryId);
  }

  // Agrupa o que já existe pela mesma "compra:parcela" do plano. Entre cópias,
  // fica a que tem nota do Luiz, depois a que já está no formato novo.
  const score = (u: (typeof existing)[number]) => (u.note ? 2 : 0) + (u.externalId!.startsWith("pluggy:p:") ? 1 : 0);
  const bySlot = new Map<string, (typeof existing)[number][]>();
  const leftovers: (typeof existing)[number][] = [];
  for (const u of existing) {
    const k = legacyKey(u);
    if (!k) {
      leftovers.push(u);
      continue;
    }
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k)!.push(u);
  }

  const used = new Set<string>();
  for (const p of plan) {
    const slot = `${p.purchaseKey}:${p.n}`;
    const candidates = (bySlot.get(slot) ?? []).sort((x, y) => score(y) - score(x));
    // Sem linha pra essa compra:parcela, aproveita uma que sobrou com a mesma
    // descrição e data perto (compra cujo código mudou) — não perde a nota.
    if (candidates.length === 0) {
      const idx = leftovers.findIndex(
        (u) => u.description === p.description && Math.abs(u.dueDate.getTime() - p.dueDate.getTime()) < 4 * 864e5 && !used.has(u.id)
      );
      if (idx >= 0) candidates.push(leftovers.splice(idx, 1)[0]);
    }
    const keep = candidates[0];
    const categoryId = categoryOfPurchase.get(p.purchaseKey) ?? candidates.find((c) => c.categoryId)?.categoryId ?? null;
    const label = `${p.description.slice(0, 28)} ${p.n}/${p.total}`;
    if (keep) {
      used.add(keep.id);
      const note = keep.note ?? candidates.find((c) => c.note)?.note ?? null;
      const changed =
        keep.externalId !== p.externalId ||
        keep.dueDate.getTime() !== p.dueDate.getTime() ||
        Math.abs(keep.amount - p.amount) > 0.005 ||
        keep.description !== p.description ||
        (!keep.categoryId && categoryId) ||
        keep.note !== note;
      if (changed) {
        log.push(`ajusta ${label} ${p.dueDate.toISOString().slice(0, 10)} R$${p.amount}`);
        if (!dryRun) {
          await prisma.upcomingInstallment.update({
            where: { id: keep.id },
            data: { externalId: p.externalId, dueDate: p.dueDate, amount: p.amount, description: p.description, categoryId: keep.categoryId ?? categoryId, note },
          });
        }
        updated++;
      }
      for (const extra of candidates.slice(1)) {
        log.push(`apaga  ${label} (cópia repetida)`);
        if (!dryRun) await prisma.upcomingInstallment.delete({ where: { id: extra.id } });
        deleted++;
      }
    } else {
      log.push(`cria   ${label} ${p.dueDate.toISOString().slice(0, 10)} R$${p.amount}`);
      if (!dryRun) {
        await prisma.upcomingInstallment.create({
          data: { externalId: p.externalId, dueDate: p.dueDate, amount: p.amount, description: p.description, cardLabel: broker.name, categoryId },
        });
      }
      created++;
    }
  }

  // Tudo que não está no plano sai: parcela já lançada, compra estornada,
  // compra terminada, cópia de formato antigo.
  const planned = new Set(plan.map((p) => `${p.purchaseKey}:${p.n}`));
  for (const [slot, rows] of bySlot) {
    if (planned.has(slot)) continue;
    for (const u of rows) {
      log.push(`apaga  ${u.description.slice(0, 28)} ${u.dueDate.toISOString().slice(0, 10)} (fora do plano)`);
      if (!dryRun) await prisma.upcomingInstallment.delete({ where: { id: u.id } });
      deleted++;
    }
  }
  for (const u of leftovers) {
    if (used.has(u.id)) continue;
    log.push(`apaga  ${u.description.slice(0, 28)} ${u.dueDate.toISOString().slice(0, 10)} (sem compra na Pluggy)`);
    if (!dryRun) await prisma.upcomingInstallment.delete({ where: { id: u.id } });
    deleted++;
  }
  return { created, updated, deleted, log };
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
  let datesUpdated = 0; // data corrigida porque a Pluggy mudou (ver effectiveDate)
  let futureBilledRemoved = 0; // parcela de fatura futura gravada por versão antiga
  let categorizedCount = 0;
  let pixSynced = 0;
  let pixIgnored = 0; // recebido, ou pra mim mesmo, ou sem documento do destinatário
  let utilityBoletoSynced = 0;

  const allCreditTransactions: PluggyTransaction[] = [];
  for (const account of creditAccounts) {
    const { results: transactions } = (await getTransactions(account.id)) as { results: PluggyTransaction[] };

    // Passo 1: grava cada transação real — a Pluggy devolve UMA por mês de
    // fatura pra compra parcelada (é a cobrança daquele mês, aconteceu de
    // verdade), então todas viram Transaction, sem exceção.
    const newlyCreated: { tx: PluggyTransaction; categoryId: string | null }[] = [];
    for (const tx of transactions) {
      const externalId = `pluggy:${tx.id}`;
      const existing = await prisma.transaction.findUnique({ where: { externalId }, include: { splits: { select: { id: true } } } });
      // Parcela de fatura futura (ver `isFutureBilled`) nunca é gasto ainda —
      // e se uma versão antiga do sync já gravou (Usina Solar: 13 parcelas
      // futuras gravadas como gasto de fev/26), sai. Ela volta sozinha como
      // Transaction quando a fatura dela chegar.
      if (isFutureBilled(tx)) {
        if (existing && existing.splits.length === 0) {
          await prisma.transaction.delete({ where: { id: existing.id } });
          futureBilledRemoved++;
        }
        continue;
      }
      if (existing) {
        // A Pluggy muda a data de uma parcela quando ela entra na fatura (Usina
        // Solar, parcela 8: 03/02 → 21/09), e antes o sync nunca revisitava
        // transação já gravada. Corrige a data (e marca a parcela, se faltar)
        // sem tocar em mais nada — categoria/nota ficam como o Luiz deixou.
        const date = effectiveDate(tx);
        const fields = installmentFields(tx);
        // Compara o DIA do calendário (UTC), não a diferença em horas — 03/03
        // 00h e 02/03 12h ficam a menos de 24h e escapavam (Usina, 02/10).
        const dateChanged = existing.date.toISOString().slice(0, 10) !== date.toISOString().slice(0, 10);
        const installmentMissing = fields.installmentNumber != null && existing.installmentNumber !== fields.installmentNumber;
        if (!existing.pluggyPending && (dateChanged || installmentMissing)) {
          await prisma.transaction.update({ where: { id: existing.id }, data: { date, ...fields } });
          datesUpdated++;
        }
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
              date: effectiveDate(tx),
              description: tx.description,
              amount: realAmount(tx),
              isTransfer,
              categoryId,
              pluggyPending: false,
              ...installmentFields(tx),
            },
          });
          transactionsReconciled++;
        } else if (!existing.pluggyPending) {
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
            date: effectiveDate(tx),
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
          date: effectiveDate(tx),
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

    allCreditTransactions.push(...transactions);
  }

  // Passo 2: parcelas futuras — reconcilia a corretora inteira de uma vez
  // (todas as contas de cartão), ver `reconcileInstallments`.
  if (creditAccounts.length > 0) {
    installmentsCreated += (await reconcileInstallments(allCreditTransactions, broker)).created;
  }

  // Pix (07/09, pedido do Luiz: "vamos implementar trazer o pix de todos os
  // bancos"). Só SAÍDA (DEBIT) pra terceiro de verdade — ver isPixToThirdParty
  // e a nota travada no topo do arquivo sobre nunca inferir receita daqui.
  for (const account of bankAccounts) {
    const { results: transactions } = (await getTransactions(account.id)) as { results: PluggyTransaction[] };

    for (const tx of transactions) {
      const isPix = tx.operationType === "PIX" && tx.type === "DEBIT";
      const isUtility = isUtilityBoleto(tx);
      if (!isPix && !isUtility) continue;
      if (isPix && !isPixToThirdParty(tx)) {
        pixIgnored++;
        continue;
      }

      const externalId = `pluggy:${tx.id}`;
      const existing = await prisma.transaction.findUnique({ where: { externalId } });
      // Pix não tem estado PENDING pra reconciliar; boleto de consumo
      // também não (chega direto POSTED) — os dois só existem ou não.
      if (existing) continue;

      // "br_utility" é um rótulo interno da Pluggy, ilegível pra quem lê a
      // lista — o Luiz decide o que tem dentro (aluguel/água/gás/internet/
      // seguro) dividindo a transação em categorias na hora de revisar
      // (ver TransactionSplit), então a descrição só precisa dizer "isso é
      // aquele boleto mensal", nunca inventar um detalhe que a Pluggy não
      // mandou de verdade.
      const description = isUtility ? "Boleto — contas do mês (aluguel/água/luz/etc.)" : pixDescription(tx);
      const amount = Math.abs(realAmount(tx));

      // Mesmo lançamento manual adiantado + reconciliação já usado pra
      // cartão (ver findAwaitingMatch acima) — é literalmente o caso que
      // motivou o pedido: "Faxina"/"Hotel em Natal" lançados na hora,
      // confirmados aqui quando o Pix (ou o boleto) de verdade aparece.
      const manualMatch = await findAwaitingMatch(broker.id, amount, new Date(tx.date));
      if (manualMatch) {
        await prisma.transaction.update({
          where: { id: manualMatch.id },
          data: { date: new Date(tx.date), description, amount, externalId, awaitingPluggyMatch: false },
        });
        if (isUtility) utilityBoletoSynced++;
        else pixSynced++;
        continue;
      }

      // Boleto de consumo nunca tenta auto-categorizar (o rótulo é nosso
      // próprio, genérico — não tem comerciante real pra CategorizationRule
      // aprender nada) — fica sem categoria até o Luiz dividir em Aluguel/
      // Água/Gás/Internet/Seguro (ou categorizar como uma coisa só, se um
      // mês não tiver mais de uma conta dentro).
      const categoryId = isUtility ? null : (await suggestCategory(description))?.id ?? null;
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
      if (isUtility) utilityBoletoSynced++;
      else pixSynced++;
    }
  }

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: new Date() } });

  return { transactionsSynced, transactionsSkipped, transactionsReconciled, installmentsCreated, datesUpdated, futureBilledRemoved, categorizedCount, pixSynced, pixIgnored, utilityBoletoSynced };
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
    datesUpdated: number;
    futureBilledRemoved: number;
    categorizedCount: number;
    pixSynced: number;
    pixIgnored: number;
    utilityBoletoSynced: number;
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
        datesUpdated: 0,
        futureBilledRemoved: 0,
        categorizedCount: 0,
        pixSynced: 0,
        pixIgnored: 0,
        utilityBoletoSynced: 0,
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
      datesUpdated: acc.datesUpdated + r.datesUpdated,
      futureBilledRemoved: acc.futureBilledRemoved + r.futureBilledRemoved,
      categorizedCount: acc.categorizedCount + r.categorizedCount,
      pixSynced: acc.pixSynced + r.pixSynced,
      pixIgnored: acc.pixIgnored + r.pixIgnored,
      utilityBoletoSynced: acc.utilityBoletoSynced + r.utilityBoletoSynced,
    }),
    {
      transactionsSynced: 0,
      transactionsSkipped: 0,
      transactionsReconciled: 0,
      installmentsCreated: 0,
      datesUpdated: 0,
      futureBilledRemoved: 0,
      categorizedCount: 0,
      pixSynced: 0,
      pixIgnored: 0,
      utilityBoletoSynced: 0,
    }
  );

  return { ...totals, perBroker };
}
