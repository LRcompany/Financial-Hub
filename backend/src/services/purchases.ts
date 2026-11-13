// Compra parcelada como UMA coisa só (05/11) — ver model Purchase.
//
// Pedido do Luiz depois do sync de 04/11 (18 parcelas chegando "sem
// categoria"): "parece que você faz remendos e não uma solução que resolva o
// problema". A categoria morava em cada linha (parcela lançada e parcela
// prevista), e a troca de uma pela outra perdia o que o Luiz tinha escolhido.
// Agora a categoria e a nota moram na compra, e este arquivo é o ÚNICO lugar
// que grava categoria/nota de parcela:
//   - Categorizar qualquer parcela (Orçamento, revisão, Saúde dos dados) →
//     `setPurchaseFields` grava na compra e em todas as parcelas dela.
//   - Parcela nova (sync) entra já com a categoria/nota da compra
//     (`purchaseFields`).
// A Saúde dos dados confere a regra todo dia ("parcela-diferente-da-compra").

import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { purchaseBase } from "./ledger.js";
import { pickPurchaseValue } from "./pluggyTransactionSync.js";

type Fields = { categoryId?: string | null; note?: string | null };

/** Grava categoria e/ou nota na compra e em TODAS as parcelas dela (lançadas
 * e previstas). Transação dividida mantém as fatias como estão — a categoria
 * de cada fatia é dela. */
export async function setPurchaseFields(purchaseIds: string[], data: Fields): Promise<void> {
  const ids = [...new Set(purchaseIds.filter(Boolean))];
  if (ids.length === 0 || (data.categoryId === undefined && data.note === undefined)) return;
  const { categoryId, note } = data;
  await prisma.$transaction([
    prisma.purchase.updateMany({ where: { id: { in: ids } }, data }),
    prisma.upcomingInstallment.updateMany({ where: { purchaseId: { in: ids } }, data }),
    ...(categoryId !== undefined ? [prisma.transaction.updateMany({ where: { purchaseId: { in: ids }, splits: { none: {} } }, data: { categoryId } })] : []),
    ...(note !== undefined ? [prisma.transaction.updateMany({ where: { purchaseId: { in: ids } }, data: { note } })] : []),
  ]);
}

/** Depois de gravar categoria/nota em linhas soltas (transações ou parcelas
 * previstas), leva o mesmo valor pra compra de cada uma e pras irmãs dela. */
export async function propagateFromRows(rows: { transactionIds?: string[]; installmentIds?: string[] }, data: Fields): Promise<void> {
  const [txs, insts] = await Promise.all([
    rows.transactionIds?.length ? prisma.transaction.findMany({ where: { id: { in: rows.transactionIds } }, select: { purchaseId: true } }) : [],
    rows.installmentIds?.length ? prisma.upcomingInstallment.findMany({ where: { id: { in: rows.installmentIds } }, select: { purchaseId: true } }) : [],
  ]);
  await setPurchaseFields([...txs, ...insts].flatMap((r) => (r.purchaseId ? [r.purchaseId] : [])), data);
}

/** Categoria/nota com que uma parcela nova dessa compra deve entrar. */
export async function purchaseFields(purchaseId: string): Promise<{ categoryId: string | null; note: string | null }> {
  const p = await prisma.purchase.findUnique({ where: { id: purchaseId }, select: { categoryId: true, note: true } });
  return { categoryId: p?.categoryId ?? null, note: p?.note ?? null };
}

/** Código da compra de uma parcela DIGITADA (sem Pluggy — cartão Caixa,
 * planilha): mesmo cartão + mesma compra + mesmo valor de parcela, a mesma
 * regra que `buildInstallmentPositions` já usa pra contar "N de Total". */
export function manualPurchaseId(cardLabel: string | null, description: string, amount: number): string {
  const key = crypto.createHash("sha1").update(`${cardLabel ?? ""}|${purchaseBase(description)}|${amount.toFixed(2)}`).digest("hex").slice(0, 16);
  return `m:${key}`;
}

/** Liga as parcelas DIGITADAS (sem Pluggy) à compra delas e deixa todas com a
 * mesma categoria/nota. Parcela da Pluggy é ligada pelo sync
 * (`reconcileInstallments`). Idempotente — roda na migração de 05/11 e todo
 * dia no agendador, pra pegar parcela nova de planilha. */
type ManualRow = { id: string; kind: "u" | "t"; purchaseId: string | null; categoryId: string | null; note: string | null; date: Date };

export async function linkManualPurchases({ dryRun = false }: { dryRun?: boolean } = {}): Promise<string[]> {
  const log: string[] = [];
  const [upcoming, txs] = await Promise.all([
    prisma.upcomingInstallment.findMany({ where: { externalId: null } }),
    prisma.transaction.findMany({
      where: { type: "expense", NOT: { source: "pluggy" }, OR: [{ installmentNumber: { not: null } }, { totalInstallments: { gt: 1 } }] },
      include: { broker: { select: { name: true } } },
    }),
  ]);
  const groups = new Map<string, { description: string; cardLabel: string | null; amount: number; total: number | null; rows: ManualRow[] }>();
  const add = (cardLabel: string | null, description: string, amount: number, total: number | null, row: ManualRow) => {
    const id = manualPurchaseId(cardLabel, description, amount);
    if (!groups.has(id)) groups.set(id, { description: purchaseBase(description), cardLabel, amount, total, rows: [] });
    groups.get(id)!.rows.push(row);
  };
  for (const u of upcoming) add(u.cardLabel, u.description, u.amount, u.totalInstallments, { id: u.id, kind: "u", purchaseId: u.purchaseId, categoryId: u.categoryId, note: u.note, date: u.dueDate });
  for (const t of txs) add(t.broker?.name ?? null, t.description, t.amount, t.totalInstallments, { id: t.id, kind: "t", purchaseId: t.purchaseId, categoryId: t.categoryId, note: t.note, date: t.date });

  const saved = new Map((await prisma.purchase.findMany({ where: { id: { in: [...groups.keys()] } } })).map((p) => [p.id, p]));
  for (const [id, g] of groups) {
    const rows = [...g.rows].sort((a, b) => b.date.getTime() - a.date.getTime());
    const p = saved.get(id);
    const categoryId = p?.categoryId ?? pickPurchaseValue(rows.map((r) => r.categoryId));
    const note = p?.note ?? rows.find((r) => r.note)?.note ?? null;
    const unlinked = rows.filter((r) => r.purchaseId !== id);
    const off = rows.filter((r) => (categoryId && r.categoryId !== categoryId) || (note && r.note !== note));
    if (unlinked.length === 0 && off.length === 0 && p) continue;
    log.push(`compra digitada ${g.cardLabel ?? "?"} ${g.description.slice(0, 28)} R$${g.amount}: ${unlinked.length} parcela(s) ligada(s), ${off.length} com outra categoria/nota`);
    if (dryRun) continue;
    const data = { cardLabel: g.cardLabel, description: g.description, installmentAmount: g.amount, totalInstallments: g.total, categoryId, note };
    await prisma.purchase.upsert({ where: { id }, create: { id, ...data }, update: data });
    const uIds = unlinked.filter((r) => r.kind === "u").map((r) => r.id);
    const tIds = unlinked.filter((r) => r.kind === "t").map((r) => r.id);
    if (uIds.length) await prisma.upcomingInstallment.updateMany({ where: { id: { in: uIds } }, data: { purchaseId: id } });
    if (tIds.length) await prisma.transaction.updateMany({ where: { id: { in: tIds } }, data: { purchaseId: id } });
    await setPurchaseFields([id], { categoryId: categoryId ?? undefined, note: note ?? undefined });
  }
  return log;
}
