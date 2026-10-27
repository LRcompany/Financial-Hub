// Verificação de integridade dos dados (27/10) — pedido do Luiz: "eu não quero
// depois de 2 meses de uso falar pra você verificar os números novamente".
//
// Regras que precisam valer SEMPRE. Roda todo dia depois do sync (scheduler),
// sob demanda em GET /api/data-health e pelo conector do Claude. Cada regra
// quebrada vira um item com gravidade:
//   - "erro": número errado na tela (gasto em dobro, valor que some...).
//   - "aviso": dado incompleto ou velho que pode distorcer um número.
// E cada aviso diz COMO resolver (`action`, 27/10 — "mas e aí, o que eu faço
// com isso?"): o app mostra um botão que resolve ali mesmo.
// Só olha de set/2026 em diante — o Command OS passou a valer ali.

import { prisma } from "../prisma.js";
import { expenseLedger, ledgerTotal, purchaseBase } from "./ledger.js";
import { isCalendarNoon } from "./dates.js";

export type HealthRef = { kind: "transaction" | "installment" | "broker" | "snapshot" | "receipt"; id: string };
export type HealthItem = { key: string; label: string; ref?: HealthRef };
export type HealthAction =
  | "auto-fix" // o app conserta sozinho (botão "Corrigir agora")
  | "categorize" // escolher categoria (botão "Categorizar")
  | "update-broker" // digitar o valor da corretora (botão "Atualizar valor")
  | "reconnect" // refazer o login do banco (botão "Reconectar")
  | "review"; // só o Luiz sabe: "Apagar o repetido" ou "É assim mesmo"

export type HealthIssue = {
  id: string;
  severity: "erro" | "aviso";
  title: string;
  detail: string;
  action: HealthAction;
  items: HealthItem[]; // no máximo 20 — `total` diz quantos são
  total: number;
};

export const DATA_START = new Date(2026, 8, 1); // 01/09/2026
const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function runDataHealth(now = new Date()): Promise<{ checkedAt: string; ok: boolean; issues: HealthIssue[] }> {
  const ignored = new Set((await prisma.dataHealthIgnore.findMany({ select: { key: true } })).map((i) => i.key));
  const issues: HealthIssue[] = [];
  const push = (id: string, severity: HealthIssue["severity"], action: HealthAction, title: string, detail: string, items: HealthItem[]) => {
    const visible = items.filter((i) => !ignored.has(i.key));
    if (visible.length > 0) issues.push({ id, severity, action, title, detail, items: visible.slice(0, 20), total: visible.length });
  };
  const item = (issueId: string, label: string, ref?: HealthRef): HealthItem => ({ key: `${issueId}:${ref ? `${ref.kind}:${ref.id}` : label}`, label, ref });

  const horizon = new Date(now.getFullYear(), now.getMonth() + 24, 1);
  const [txs, upcoming, snaps, brokers, receipts, parentIds] = await Promise.all([
    prisma.transaction.findMany({ where: { date: { gte: DATA_START } }, include: { splits: true, broker: { select: { name: true } } } }),
    prisma.upcomingInstallment.findMany({ where: { dueDate: { gte: DATA_START, lt: horizon } } }),
    prisma.positionSnapshot.findMany({ where: { year: { gte: 2026 } }, include: { broker: true, security: true } }),
    prisma.broker.findMany({ where: { archivedAt: null } }),
    prisma.projectReceipt.findMany({ where: { paymentDate: { gte: DATA_START } }, include: { transactions: true, project: true } }),
    prisma.category.findMany({ where: { children: { some: {} } }, select: { id: true } }).then((r) => new Set(r.map((c) => c.id))),
  ]);
  const expenses = txs.filter((t) => t.type === "expense" && !t.isTransfer);

  // 1. Parcela contada duas vezes (já lançada E ainda prevista, ou prevista 2x).
  const slotOf = (card: string | null | undefined, desc: string, amount: number, n: number | string) => `${card}|${purchaseBase(desc)}|${Math.round(amount)}|${n}`;
  const postedSlots = new Set(expenses.filter((t) => t.installmentNumber).map((t) => slotOf(t.broker?.name, t.description, t.amount, t.installmentNumber!)));
  const dup: HealthItem[] = [];
  const seenSlots = new Set<string>();
  for (const u of upcoming) {
    const n = u.externalId?.match(/:(\d+)$/)?.[1];
    if (!u.externalId?.startsWith("pluggy:") || !n) continue;
    const slot = slotOf(u.cardLabel, u.description, u.amount, n);
    if (postedSlots.has(slot) || seenSlots.has(slot)) dup.push(item("parcela-duplicada", `${u.description.trim()} parcela ${n} (${day(u.dueDate)}, ${brl(u.amount)})`, { kind: "installment", id: u.id }));
    seenSlots.add(slot);
  }
  push("parcela-duplicada", "erro", "auto-fix", "Parcela contada duas vezes", "A mesma parcela aparece mais de uma vez — o gasto do mês fica maior do que foi.", dup);

  // 2. Parcela manual (cartão sem Pluggy) igual a uma da Pluggy no mesmo mês.
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const pluggyKeys = new Set(upcoming.filter((u) => u.externalId?.startsWith("pluggy:")).map((u) => `${purchaseBase(u.description)}|${u.amount.toFixed(2)}|${monthKey(u.dueDate)}`));
  push(
    "parcela-manual-repete-pluggy",
    "erro",
    "auto-fix",
    "Parcela digitada repete uma da Pluggy",
    "Parcela lançada à mão com mesma descrição, valor e mês de uma que já vem da Pluggy.",
    upcoming
      .filter((u) => !u.externalId && pluggyKeys.has(`${purchaseBase(u.description)}|${u.amount.toFixed(2)}|${monthKey(u.dueDate)}`))
      .map((u) => item("parcela-manual-repete-pluggy", `${u.description} ${brl(u.amount)} ${day(u.dueDate)}`, { kind: "installment", id: u.id }))
  );

  // 3. Lançamento manual que parece repetir um da Pluggy (mesmo valor, ±3 dias).
  const pluggyExp = expenses.filter((t) => t.source === "pluggy");
  push(
    "manual-repete-pluggy",
    "aviso",
    "review",
    "Gasto manual parecido com um da Pluggy",
    "Mesmo valor em até 3 dias — se for o mesmo gasto, apague o manual; se forem gastos diferentes, marque \"é assim mesmo\".",
    expenses
      .filter((t) => t.source === "manual")
      .flatMap((m) =>
        pluggyExp
          .filter((p) => Math.abs(p.amount - m.amount) < 0.01 && Math.abs(p.date.getTime() - m.date.getTime()) < 3 * 864e5)
          .map((p) => item("manual-repete-pluggy", `${m.description} (${day(m.date)}) ~ ${p.description} (${day(p.date)}) ${brl(m.amount)}`, { kind: "transaction", id: m.id }))
      )
  );

  // 4. Mesmo lançamento da Pluggy repetido (descrição, valor e dia iguais).
  const sameDay = new Map<string, typeof pluggyExp>();
  for (const t of pluggyExp) {
    const k = `${t.description}|${t.amount}|${day(t.date)}`;
    sameDay.set(k, [...(sameDay.get(k) ?? []), t]);
  }
  push(
    "pluggy-repetido",
    "aviso",
    "review",
    "Mesmo gasto repetido no mesmo dia",
    "Pode ser compra repetida de verdade (dois cafés) — aí marque \"é assim mesmo\" — ou lançamento duplicado — aí apague o repetido.",
    [...sameDay.values()]
      .filter((list) => list.length > 1)
      .map((list) => item("pluggy-repetido", `${list[0].description} ${brl(list[0].amount)} ${day(list[0].date)} (${list.length}x)`, { kind: "transaction", id: list[list.length - 1].id }))
  );

  // 5. Divisão que não fecha com o valor da transação.
  push(
    "divisao-nao-fecha",
    "erro",
    "review",
    "Divisão não fecha com o valor",
    "A soma das partes é diferente do valor da transação — abra a transação no Orçamento e ajuste a divisão.",
    txs
      .filter((t) => t.splits.length && Math.abs(t.splits.reduce((s, x) => s + x.amount, 0) - t.amount) > 0.01)
      .map((t) => item("divisao-nao-fecha", `${t.description} ${brl(t.amount)} (${day(t.date)})`, { kind: "transaction", id: t.id }))
  );

  // 6. Despesa negativa contando como gasto (estorno sem marcar).
  push(
    "despesa-negativa",
    "erro",
    "auto-fix",
    "Estorno contando como gasto",
    "Despesa com valor negativo que não está marcada como transferência — diminui o gasto do mês errado.",
    expenses.filter((t) => t.amount < 0).map((t) => item("despesa-negativa", `${t.description} ${brl(t.amount)} ${day(t.date)}`, { kind: "transaction", id: t.id }))
  );

  // 7. Gasto sem categoria (lançado ou parcela).
  const uncategorized = (await expenseLedger(DATA_START, new Date(now.getFullYear(), now.getMonth() + 1, 1))).filter((i) => !i.categoryId);
  push(
    "sem-categoria",
    "aviso",
    "categorize",
    "Gasto sem categoria",
    `${uncategorized.length} gasto(s), ${brl(ledgerTotal(uncategorized))} — conta no total, mas fica fora das metas.`,
    uncategorized.map((i) =>
      item("sem-categoria", `${i.description} ${brl(i.amount)} ${day(i.date)}`, { kind: i.kind === "posted" ? "transaction" : "installment", id: i.transactionId ?? i.id })
    )
  );

  // 8. Lançamento em categoria-mãe (meta é sempre na folha).
  push(
    "categoria-mae",
    "aviso",
    "categorize",
    "Gasto numa categoria-mãe",
    "Meta é sempre definida na subcategoria — escolha a subcategoria certa.",
    expenses
      .filter((t) => t.categoryId && parentIds.has(t.categoryId))
      .map((t) => item("categoria-mae", `${t.description} ${brl(t.amount)} ${day(t.date)}`, { kind: "transaction", id: t.id }))
  );

  // 9. Recebimento de projeto sem a entrada correspondente (ou valor diferente).
  push(
    "recebimento-sem-entrada",
    "erro",
    "auto-fix",
    "Recebimento de projeto sem entrada",
    "Todo recebimento vira uma entrada no Orçamento com o mesmo valor.",
    receipts
      .filter((r) => r.transactions.length !== 1 || Math.abs(r.transactions[0].amount - r.amount) > 0.01)
      .map((r) => item("recebimento-sem-entrada", `${r.project.name} ${brl(r.amount)} (${day(r.paymentDate)})`, { kind: "receipt", id: r.id }))
  );

  // 10. Posição com valor zero mas investido (título resgatado/trocado).
  push(
    "posicao-zerada-com-investido",
    "erro",
    "auto-fix",
    "Investimento zerado com valor investido",
    "Título com valor de mercado zero ainda somando no investido — distorce aporte e rendimento.",
    snaps
      .filter((s) => !s.broker.archivedAt && s.marketValue <= 0 && s.investedAmount > 0)
      .map((s) => item("posicao-zerada-com-investido", `${s.broker.name} ${s.security.name} ${s.month}/${s.year}`, { kind: "snapshot", id: s.id }))
  );

  // 11. Corretora manual (sem Pluggy) sem o valor do mês que FECHOU. O Luiz
  //     atualiza no dia 1 com o valor de fechamento do mês anterior ("a Wise e
  //     a INCO eu só devo atualizar no dia 1") — só avisa se até o dia 5 o
  //     valor do mês anterior ainda não entrou.
  const lastYm = new Map<string, number>();
  for (const s of snaps) lastYm.set(s.brokerId, Math.max(lastYm.get(s.brokerId) ?? 0, s.year * 12 + s.month));
  const expectedYm = now.getFullYear() * 12 + now.getMonth(); // mês anterior (snapshot usa mês 1–12)
  push(
    "corretora-manual-desatualizada",
    "aviso",
    "update-broker",
    "Corretora manual sem o valor do mês passado",
    "Sem Pluggy, o valor é digitado no dia 1 — enquanto não entra, o patrimônio repete o último valor.",
    now.getDate() > 5
      ? brokers
          .filter((b) => b.dataSource === "manual_statement" && (lastYm.get(b.id) ?? 0) > 0 && (lastYm.get(b.id) ?? 0) < expectedYm)
          .map((b) => {
            const ym = lastYm.get(b.id)!;
            const m = ym % 12 || 12;
            return item("corretora-manual-desatualizada", `${b.name} — último valor de ${String(m).padStart(2, "0")}/${(ym - m) / 12}`, { kind: "broker", id: b.id });
          })
      : []
  );

  // 12. Conexão da Pluggy parada (sync falhando ou banco pedindo novo login).
  push(
    "pluggy-parada",
    "aviso",
    "reconnect",
    "Banco sem sincronizar",
    "Sem sync há mais de 2 dias — gastos e saldos desse banco podem estar faltando. Reconecte o banco.",
    brokers
      .filter((b) => b.dataSource === "pluggy" && (!b.lastSyncedAt || now.getTime() - b.lastSyncedAt.getTime() > 48 * 3600 * 1000))
      .map((b) => item("pluggy-parada", `${b.name} — último sync ${b.lastSyncedAt ? day(b.lastSyncedAt) : "nunca"}`, { kind: "broker", id: b.id }))
  );

  // 13. Data fora do padrão "dia do Brasil ao meio-dia" (ver services/dates.ts).
  push(
    "data-fora-do-padrao",
    "erro",
    "auto-fix",
    "Data gravada fora do padrão",
    "Data que não está como dia do calendário (meio-dia) — o gasto pode cair no dia ou mês errado.",
    [
      ...txs.filter((t) => !isCalendarNoon(t.date)).map((t) => item("data-fora-do-padrao", `${t.description} ${t.date.toISOString()}`, { kind: "transaction", id: t.id })),
      ...upcoming
        .filter((u) => !isCalendarNoon(u.dueDate))
        .map((u) => item("data-fora-do-padrao", `parcela ${u.description} ${u.dueDate.toISOString()}`, { kind: "installment", id: u.id })),
    ]
  );

  // Parcela manual vencida que ninguém confirma é normal pro cartão Caixa (sem
  // Pluggy, o Luiz paga a fatura) — não é aviso.

  return { checkedAt: now.toISOString(), ok: !issues.some((i) => i.severity === "erro"), issues };
}
