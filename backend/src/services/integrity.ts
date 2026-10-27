// Verificação de integridade dos dados (27/10) — pedido do Luiz: "eu não quero
// depois de 2 meses de uso falar pra você verificar os números novamente".
//
// Regras que precisam valer SEMPRE. Roda todo dia depois do sync (scheduler),
// sob demanda em GET /api/data-health e pelo conector do Claude. Cada regra
// quebrada vira um item com gravidade:
//   - "erro": número errado na tela (gasto em dobro, valor que some...).
//   - "aviso": dado incompleto ou velho que pode distorcer um número.
// Só olha de set/2026 em diante — o Command OS passou a valer ali (dado
// anterior veio da planilha e fica como histórico).

import { prisma } from "../prisma.js";
import { expenseLedger, ledgerTotal, purchaseBase } from "./ledger.js";
import { isCalendarNoon } from "./dates.js";

export type HealthIssue = {
  id: string;
  severity: "erro" | "aviso";
  title: string;
  detail: string;
  items: string[]; // até 10 exemplos
};

export const DATA_START = new Date(2026, 8, 1); // 01/09/2026
const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function runDataHealth(now = new Date()): Promise<{ checkedAt: string; ok: boolean; issues: HealthIssue[] }> {
  const issues: HealthIssue[] = [];
  const push = (id: string, severity: HealthIssue["severity"], title: string, detail: string, items: string[]) => {
    if (items.length > 0) issues.push({ id, severity, title, detail, items: items.slice(0, 10) });
  };

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

  // 1. Parcela contada duas vezes: mesma compra e mesmo número de parcela no
  //    mesmo mês, entre parcela lançada e parcela ainda não lançada da Pluggy.
  const postedSlots = new Set(
    expenses.filter((t) => t.installmentNumber).map((t) => `${t.broker?.name}|${purchaseBase(t.description)}|${Math.round(t.amount)}|${t.installmentNumber}`)
  );
  const pendingDup: string[] = [];
  const pendingSeen = new Map<string, number>();
  for (const u of upcoming) {
    const n = u.externalId?.match(/:(\d+)$/)?.[1];
    if (!u.externalId?.startsWith("pluggy:") || !n) continue;
    const slot = `${u.cardLabel}|${purchaseBase(u.description)}|${Math.round(u.amount)}|${n}`;
    if (postedSlots.has(slot)) pendingDup.push(`${u.description.trim()} parcela ${n} — já lançada e ainda prevista`);
    pendingSeen.set(slot, (pendingSeen.get(slot) ?? 0) + 1);
  }
  for (const [slot, c] of pendingSeen) if (c > 1) pendingDup.push(`${slot.split("|")[1]} parcela ${slot.split("|")[3]} prevista ${c}x`);
  push("parcela-duplicada", "erro", "Parcela contada duas vezes", "A mesma parcela aparece mais de uma vez — o gasto do mês fica maior do que foi.", pendingDup);

  // 2. Parcela manual (cartão sem Pluggy) igual a uma da Pluggy no mesmo mês.
  const pluggyKeys = new Set(upcoming.filter((u) => u.externalId?.startsWith("pluggy:")).map((u) => `${purchaseBase(u.description)}|${u.amount.toFixed(2)}|${u.dueDate.getFullYear()}-${u.dueDate.getMonth()}`));
  push(
    "parcela-manual-repete-pluggy",
    "erro",
    "Parcela digitada repete uma da Pluggy",
    "Parcela lançada à mão com mesma descrição, valor e mês de uma que já vem da Pluggy.",
    upcoming
      .filter((u) => !u.externalId && pluggyKeys.has(`${purchaseBase(u.description)}|${u.amount.toFixed(2)}|${u.dueDate.getFullYear()}-${u.dueDate.getMonth()}`))
      .map((u) => `${u.description} ${brl(u.amount)} ${day(u.dueDate)}`)
  );

  // 3. Lançamento manual que parece repetir um da Pluggy (mesmo valor, ±3 dias).
  const pluggyExp = expenses.filter((t) => t.source === "pluggy");
  push(
    "manual-repete-pluggy",
    "aviso",
    "Gasto manual parecido com um da Pluggy",
    "Mesmo valor em até 3 dias — confira se não é o mesmo gasto lançado duas vezes.",
    expenses
      .filter((t) => t.source === "manual")
      .flatMap((m) =>
        pluggyExp
          .filter((p) => Math.abs(p.amount - m.amount) < 0.01 && Math.abs(p.date.getTime() - m.date.getTime()) < 3 * 864e5)
          .map((p) => `${m.description} (${day(m.date)}) ~ ${p.description} (${day(p.date)}) ${brl(m.amount)}`)
      )
  );

  // 4. Mesmo lançamento da Pluggy repetido (descrição, valor e dia iguais).
  const sameDay = new Map<string, number>();
  for (const t of pluggyExp) {
    const k = `${t.description}|${t.amount}|${day(t.date)}`;
    sameDay.set(k, (sameDay.get(k) ?? 0) + 1);
  }
  push(
    "pluggy-repetido",
    "aviso",
    "Mesmo gasto repetido no mesmo dia",
    "Pode ser compra repetida de verdade (dois cafés) ou lançamento duplicado.",
    [...sameDay.entries()].filter(([, c]) => c > 1).map(([k, c]) => `${k.split("|")[0]} ${brl(Number(k.split("|")[1]))} ${k.split("|")[2]} (${c}x)`)
  );

  // 5. Divisão que não fecha com o valor da transação.
  push(
    "divisao-nao-fecha",
    "erro",
    "Divisão não fecha com o valor",
    "A soma das partes é diferente do valor da transação — sobra ou falta dinheiro nas categorias.",
    txs.filter((t) => t.splits.length && Math.abs(t.splits.reduce((s, x) => s + x.amount, 0) - t.amount) > 0.01).map((t) => `${t.description} ${brl(t.amount)}`)
  );

  // 6. Despesa negativa contando como gasto (estorno sem marcar).
  push(
    "despesa-negativa",
    "erro",
    "Estorno contando como gasto",
    "Despesa com valor negativo que não está marcada como transferência — diminui o gasto do mês errado.",
    expenses.filter((t) => t.amount < 0).map((t) => `${t.description} ${brl(t.amount)} ${day(t.date)}`)
  );

  // 7. Gasto sem categoria (lançado ou parcela).
  const uncategorized = (await expenseLedger(DATA_START, new Date(now.getFullYear(), now.getMonth() + 1, 1))).filter((i) => !i.categoryId);
  push(
    "sem-categoria",
    "aviso",
    "Gasto sem categoria",
    `${uncategorized.length} gasto(s), ${brl(ledgerTotal(uncategorized))} — conta no total, mas fica fora das metas.`,
    uncategorized.map((i) => `${i.description} ${brl(i.amount)} ${day(i.date)}`)
  );

  // 8. Lançamento em categoria-mãe (meta é sempre na folha).
  push(
    "categoria-mae",
    "aviso",
    "Gasto numa categoria-mãe",
    "Meta é sempre definida na subcategoria — gasto na mãe nunca bate com meta nenhuma.",
    expenses.filter((t) => t.categoryId && parentIds.has(t.categoryId)).map((t) => `${t.description} ${brl(t.amount)}`)
  );

  // 9. Recebimento de projeto sem a entrada correspondente (ou valor diferente).
  push(
    "recebimento-sem-entrada",
    "erro",
    "Recebimento de projeto sem entrada",
    "Todo recebimento vira uma entrada no Orçamento com o mesmo valor.",
    receipts.filter((r) => r.transactions.length !== 1 || Math.abs(r.transactions[0].amount - r.amount) > 0.01).map((r) => `${r.project.name} ${brl(r.amount)}`)
  );

  // 10. Posição com valor zero mas investido (título resgatado/trocado).
  push(
    "posicao-zerada-com-investido",
    "erro",
    "Investimento zerado com valor investido",
    "Título com valor de mercado zero ainda somando no investido — distorce aporte e rendimento.",
    snaps.filter((s) => !s.broker.archivedAt && s.marketValue <= 0 && s.investedAmount > 0).map((s) => `${s.broker.name} ${s.security.name} ${s.month}/${s.year}`)
  );

  // 11. Corretora manual (sem Pluggy) sem o valor do mês que FECHOU. O Luiz
  //     atualiza no dia 1 com o valor de fechamento do mês anterior (27/10:
  //     "a Wise e a INCO eu só devo atualizar no dia 1") — então em outubro o
  //     esperado é ter o valor de setembro. Só avisa se até o dia 5 o valor
  //     do mês anterior ainda não entrou (enquanto isso, o patrimônio repete
  //     o último valor lançado).
  const lastYm = new Map<string, number>();
  for (const s of snaps) lastYm.set(s.brokerId, Math.max(lastYm.get(s.brokerId) ?? 0, s.year * 12 + s.month));
  const expectedYm = now.getFullYear() * 12 + now.getMonth(); // mês anterior (month 1-based = getMonth())
  push(
    "corretora-manual-desatualizada",
    "aviso",
    "Corretora manual sem o valor do mês passado",
    "Sem Pluggy, o valor é digitado no dia 1 — enquanto não entra, o patrimônio repete o último valor.",
    now.getDate() > 5
      ? brokers
          .filter((b) => b.dataSource === "manual_statement" && (lastYm.get(b.id) ?? 0) > 0 && (lastYm.get(b.id) ?? 0) < expectedYm)
          .map((b) => {
            const ym = lastYm.get(b.id)!;
            const m = ym % 12 || 12;
            return `${b.name} — último valor de ${String(m).padStart(2, "0")}/${(ym - m) / 12}`;
          })
      : []
  );

  // 12. Conexão da Pluggy parada (sync falhando ou banco pedindo novo login).
  push(
    "pluggy-parada",
    "aviso",
    "Banco sem sincronizar",
    "Sem sync há mais de 2 dias — gastos e saldos desse banco podem estar faltando.",
    brokers
      .filter((b) => b.dataSource === "pluggy" && (!b.lastSyncedAt || now.getTime() - b.lastSyncedAt.getTime() > 48 * 3600 * 1000))
      .map((b) => `${b.name} — último sync ${b.lastSyncedAt ? day(b.lastSyncedAt) : "nunca"}`)
  );

  // 13. Data fora do padrão "dia do Brasil ao meio-dia" (ver services/dates.ts)
  //     — alguém gravou data sem passar pela regra; o dia/mês pode sair errado.
  push(
    "data-fora-do-padrao",
    "erro",
    "Data gravada fora do padrão",
    "Data que não está como dia do calendário (meio-dia) — o gasto pode cair no dia ou mês errado.",
    [
      ...txs.filter((t) => !isCalendarNoon(t.date)).map((t) => `${t.description} ${t.date.toISOString()}`),
      ...upcoming.filter((u) => !isCalendarNoon(u.dueDate)).map((u) => `parcela ${u.description} ${u.dueDate.toISOString()}`),
    ]
  );

  // Parcela manual vencida que ninguém confirma é normal pro cartão Caixa (sem
  // Pluggy, o Luiz paga a fatura) — não é aviso.

  return { checkedAt: now.toISOString(), ok: !issues.some((i) => i.severity === "erro"), issues };
}
