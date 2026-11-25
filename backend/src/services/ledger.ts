// Livro-razão de despesas — a ÚNICA conta de "quanto eu gastei" do app (27/10).
//
// Pedido do Luiz depois de um mês de bugs de número: "não quero soluções que
// funcionem só pra um caso, quero uma solução pro ambiente todo". Antes, cada
// tela tinha a sua própria conta de gasto (Orçamento só somava categoria COM
// meta, o gráfico diário somava tudo, a revisão tinha outra regra, o conector
// do Claude outra) — set/26 dava R$24.483,99 numa tela e R$24.782,37 noutra.
//
// Agora toda tela que fala de gasto lê daqui (Orçamento, gasto diário,
// detalhe de categoria, parcelas, revisão do mês, relatório, conector do
// Claude) — o mesmo período dá o mesmo número em qualquer lugar. Regras:
//   - Despesa real (`Transaction` de despesa, sem transferência). Transação
//     dividida entra uma vez por fatia, cada uma na sua categoria.
//   - Parcela ainda não lançada (`UpcomingInstallment`): a da Pluggy entra
//     como está (o sync já reconcilia — ver `reconcileInstallments`); a manual
//     (cartão Caixa, digitada) só entra se não houver lançamento real igual
//     (mesma compra + valor) no mesmo mês.
//   - Categoria de investimento (aporte) nunca é gasto.
//   - Gasto sem meta ou sem categoria conta igual no total.

import { prisma } from "../prisma.js";
import { categoryPath } from "./categorization.js";

export type LedgerItem = {
  id: string; // transação, fatia de divisão ou parcela
  kind: "posted" | "installment";
  date: Date;
  amount: number;
  categoryId: string | null;
  category: string | null; // caminho "Mãe > Folha"
  description: string; // nota do Luiz, senão a descrição original
  rawDescription: string | null; // descrição original quando há nota
  label: string; // compra (sem sufixo " xN") — agrupa itens do mesmo dia
  installmentNumber: number | null;
  totalInstallments: number | null;
  cardLabel: string | null;
  transactionId: string | null;
};

/** "bike x3" e "bike x4" (planilha) = a mesma compra; a fatura da Caixa já vem
 * com a mesma descrição em todas as parcelas. */
export function purchaseBase(description: string): string {
  return description.replace(/\s+x\d+$/i, "").trim();
}

const ymKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

// ---------- posição "N de Total" das parcelas ----------

export function parsePluggyInstallmentId(externalId: string | null): { purchaseId: string; n: number } | null {
  if (!externalId) return null;
  const match = /^pluggy:(.+):(\d+)$/.exec(externalId);
  if (!match) return null;
  return { purchaseId: match[1], n: Number(match[2]) };
}

type PositionRow = { id: string; dueDate: Date; description: string; amount: number; externalId: string | null; totalInstallments: number | null };

/** "Parcela N de Total" de cada linha. Pluggy: N vem do código da parcela e o
 * total é o maior N da compra (a última parcela sempre está no futuro). Manual:
 * conta de trás pra frente a partir do total corrigido à mão (`totalInstallments`),
 * já que as parcelas restantes de uma compra são meses seguidos. */
export function buildInstallmentPositions(rows: PositionRow[]): Map<string, { installmentNumber: number | null; totalInstallments: number | null }> {
  const result = new Map<string, { installmentNumber: number | null; totalInstallments: number | null }>();
  const pluggyMax = new Map<string, number>();
  for (const r of rows) {
    const p = parsePluggyInstallmentId(r.externalId);
    if (p) pluggyMax.set(p.purchaseId, Math.max(pluggyMax.get(p.purchaseId) ?? 0, p.n));
  }
  const manualGroups = new Map<string, PositionRow[]>();
  for (const r of rows) {
    const p = parsePluggyInstallmentId(r.externalId);
    if (p) {
      result.set(r.id, { installmentNumber: p.n, totalInstallments: r.totalInstallments ?? pluggyMax.get(p.purchaseId) ?? null });
      continue;
    }
    const key = `${purchaseBase(r.description)}|${r.amount.toFixed(2)}`;
    if (!manualGroups.has(key)) manualGroups.set(key, []);
    manualGroups.get(key)!.push(r);
  }
  for (const group of manualGroups.values()) {
    const sorted = [...group].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const total = sorted.find((r) => r.totalInstallments != null)?.totalInstallments ?? null;
    sorted.forEach((r, i) => {
      result.set(r.id, { installmentNumber: total != null ? total - sorted.length + 1 + i : null, totalInstallments: total });
    });
  }
  return result;
}

const categoryInclude = { parent: { include: { parent: true } } } as const;

/** Toda despesa do período [start, end), real e parcela ainda não lançada. */
export async function expenseLedger(start: Date, end: Date): Promise<LedgerItem[]> {
  const [transactions, upcoming, allUpcoming] = await Promise.all([
    prisma.transaction.findMany({
      where: { type: "expense", isTransfer: false, date: { gte: start, lt: end } },
      include: {
        category: { include: categoryInclude },
        broker: { select: { name: true } },
        splits: { include: { category: { include: categoryInclude } } },
      },
    }),
    prisma.upcomingInstallment.findMany({
      where: { dueDate: { gte: start, lt: end } },
      include: { category: { include: categoryInclude } },
    }),
    // Posição "N de Total" precisa de TODAS as parcelas da compra, não só do período.
    prisma.upcomingInstallment.findMany({
      select: { id: true, dueDate: true, description: true, amount: true, externalId: true, totalInstallments: true },
    }),
  ]);

  const items: LedgerItem[] = [];
  const isInvestment = (c: { kind: string } | null | undefined) => c?.kind === "investment";
  const postedKeysByMonth = new Map<string, Set<string>>();

  for (const t of transactions) {
    const mk = ymKey(t.date);
    if (!postedKeysByMonth.has(mk)) postedKeysByMonth.set(mk, new Set());
    postedKeysByMonth.get(mk)!.add(`${purchaseBase(t.description)}|${t.amount.toFixed(2)}`);
    const base = {
      kind: "posted" as const,
      date: t.date,
      description: t.note || t.description,
      rawDescription: t.note ? t.description : null,
      label: purchaseBase(t.description),
      cardLabel: t.broker?.name ?? null,
      transactionId: t.id,
    };
    if (t.splits.length > 0) {
      for (const s of t.splits) {
        if (isInvestment(s.category)) continue;
        items.push({ ...base, id: s.id, amount: s.amount, categoryId: s.categoryId, category: categoryPath(s.category), installmentNumber: null, totalInstallments: null });
      }
      continue;
    }
    if (isInvestment(t.category)) continue;
    items.push({
      ...base,
      id: t.id,
      amount: t.amount,
      categoryId: t.categoryId,
      category: t.category ? categoryPath(t.category) : null,
      installmentNumber: t.installmentNumber,
      totalInstallments: t.totalInstallments,
    });
  }

  const positions = buildInstallmentPositions(allUpcoming);
  for (const u of upcoming) {
    if (isInvestment(u.category)) continue;
    const isPluggy = u.externalId?.startsWith("pluggy:") ?? false;
    if (!isPluggy && postedKeysByMonth.get(ymKey(u.dueDate))?.has(`${purchaseBase(u.description)}|${u.amount.toFixed(2)}`)) continue;
    const pos = positions.get(u.id);
    items.push({
      id: u.id,
      kind: "installment",
      date: u.dueDate,
      amount: u.amount,
      categoryId: u.categoryId,
      category: u.category ? categoryPath(u.category) : null,
      description: u.note || u.description,
      rawDescription: u.note ? u.description : null,
      label: purchaseBase(u.description),
      installmentNumber: pos?.installmentNumber ?? null,
      totalInstallments: pos?.totalInstallments ?? null,
      cardLabel: u.cardLabel,
      transactionId: null,
    });
  }
  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Soma por categoria (null = sem categoria): total e a parte que é parcela ainda não lançada. */
export function sumByCategory(items: LedgerItem[]): Map<string | null, { spent: number; installments: number }> {
  const map = new Map<string | null, { spent: number; installments: number }>();
  for (const i of items) {
    const cur = map.get(i.categoryId) ?? { spent: 0, installments: 0 };
    cur.spent += i.amount;
    if (i.kind === "installment") cur.installments += i.amount;
    map.set(i.categoryId, cur);
  }
  return map;
}

export const ledgerTotal = (items: LedgerItem[]) => items.reduce((s, i) => s + i.amount, 0);
