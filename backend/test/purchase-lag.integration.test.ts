// Atraso do C6 depois da troca de vencimento (05/11) — reproduz, mês a mês,
// o que aconteceu de verdade, num banco SQLite de teste (nunca o real):
//   - O banco lança a parcela N um a dois meses depois do mês dela.
//   - Antes: a parcela prevista era apagada por idade e o mês fechado perdia o
//     gasto (setembro foi de R$ 24.782 pra R$ 21.059 e voltou); e a parcela
//     que chegava vinha "sem categoria".
// Regras que este teste trava:
//   1. Um mês fechado NUNCA muda de valor só porque o banco atrasou.
//   2. A prevista só sai quando a lançada daquela mesma parcela chega.
//   3. A lançada entra com a categoria e a nota da COMPRA.
//   4. Compra que some de uma resposta da Pluggy não perde parcela.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-purchase-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

type Sync = typeof import("../src/services/pluggyTransactionSync.js");
type Tx = Parameters<Sync["planInstallments"]>[0][number];
let sync: Sync;
let purchases: typeof import("../src/services/purchases.js");
let integrity: typeof import("../src/services/integrity.js");
let prisma: typeof import("../src/prisma.js")["prisma"];
let broker: { id: string; name: string };
let lazer: string;

const PURCHASE = "2026-08-03T15:00:00.000Z";
function inst(n: number, billedOn: string): Tx {
  return {
    id: `bike-${n}`,
    description: "PEOPLE BIKE",
    amount: 100,
    date: billedOn,
    type: "DEBIT",
    status: "POSTED",
    category: null,
    creditCardMetadata: { cardNumber: "1491", installmentNumber: n, totalInstallments: 6, purchaseDate: PURCHASE },
  } as Tx;
}

/** O que o sync faz com uma resposta da Pluggy: passo 1 grava cada lançamento
 * novo (só a regra do comerciante — aqui, nenhuma) e o passo 2 reconcilia. */
async function runSync(response: Tx[], now: string) {
  for (const tx of response) {
    const externalId = `pluggy:${tx.id}`;
    if (await prisma.transaction.findUnique({ where: { externalId } })) continue;
    await prisma.transaction.create({
      data: {
        date: sync.effectiveDate(tx),
        type: "expense",
        description: tx.description,
        amount: tx.amount,
        source: "pluggy",
        externalId,
        brokerId: broker.id,
        installmentNumber: tx.creditCardMetadata!.installmentNumber,
        totalInstallments: tx.creditCardMetadata!.totalInstallments,
      },
    });
  }
  return sync.reconcileInstallments(response, broker, { now: new Date(now) });
}

const sept = () => integrity.monthTotalNow("2026-09");
const oct = () => integrity.monthTotalNow("2026-10");

beforeAll(async () => {
  execSync("npx prisma migrate deploy", { env: { ...process.env }, stdio: "ignore" });
  sync = await import("../src/services/pluggyTransactionSync.js");
  purchases = await import("../src/services/purchases.js");
  integrity = await import("../src/services/integrity.js");
  prisma = (await import("../src/prisma.js")).prisma;
  broker = await prisma.broker.create({ data: { name: "C6", scope: '["credit_card"]', dataSource: "pluggy" } });
  lazer = (await prisma.category.create({ data: { name: "Bike", type: "expense" } })).id;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("compra parcelada com o banco atrasando a parcela (C6, nov/26)", () => {
  it("set: parcela 1 lançada, 2 a 6 previstas; o Luiz categoriza a compra", async () => {
    await runSync([inst(1, "2026-08-17T00:00:00Z")], "2026-09-05T12:00:00Z");
    const upcoming = await prisma.upcomingInstallment.findMany({ orderBy: { dueDate: "asc" } });
    expect(upcoming.map((u) => u.dueDate.toISOString().slice(0, 10))).toEqual(["2026-09-03", "2026-10-03", "2026-11-03", "2026-12-03", "2027-01-03"]);
    // Categoriza UMA parcela prevista (Orçamento → Revisar parcelas).
    await prisma.upcomingInstallment.update({ where: { id: upcoming[0].id }, data: { categoryId: lazer, note: "bike da Ana" } });
    await purchases.propagateFromRows({ installmentIds: [upcoming[0].id] }, { categoryId: lazer, note: "bike da Ana" });
    const all = [...(await prisma.transaction.findMany()), ...(await prisma.upcomingInstallment.findMany())];
    expect(all.every((r) => r.categoryId === lazer && r.note === "bike da Ana")).toBe(true);
    expect((await sept()).total).toBe(100);
  });

  it("nov: o banco ainda NÃO lançou a parcela de setembro — setembro continua R$ 100", async () => {
    const r = await runSync([inst(1, "2026-08-17T00:00:00Z")], "2026-11-05T12:00:00Z");
    expect(r.deleted).toBe(0);
    expect((await sept()).total).toBe(100);
    expect((await oct()).total).toBe(100);
  });

  it("nov (depois): chega a parcela 2 — troca a prevista pela lançada, mesmo valor no mesmo mês, com a categoria da compra", async () => {
    const before = await sept();
    const r = await runSync([inst(1, "2026-08-17T00:00:00Z"), inst(2, "2026-11-17T00:00:00Z")], "2026-11-20T12:00:00Z");
    expect(r.deleted).toBe(1);
    expect(await sept()).toEqual(before);
    const n2 = await prisma.transaction.findUniqueOrThrow({ where: { externalId: "pluggy:bike-2" } });
    expect(n2.date.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(n2.categoryId).toBe(lazer);
    expect(n2.note).toBe("bike da Ana");
    expect(n2.purchaseId).toMatch(/^p:/);
    // Outubro: a 3 ainda não veio, continua prevista.
    expect((await oct()).total).toBe(100);
  });

  it("a Pluggy manda a lista sem essa compra — nenhuma parcela some", async () => {
    const count = await prisma.upcomingInstallment.count();
    const other = { ...inst(1, "2026-11-10T00:00:00Z"), id: "x-1", description: "OUTRA LOJA", creditCardMetadata: { cardNumber: "1491", installmentNumber: 1, totalInstallments: 2, purchaseDate: "2026-11-10T10:00:00.000Z" } } as Tx;
    const r = await runSync([other], "2026-12-05T12:00:00Z");
    expect(await prisma.upcomingInstallment.count({ where: { description: "PEOPLE BIKE" } })).toBe(count);
    expect(r.log.some((l) => l.startsWith("mantém"))).toBe(true);
    expect((await oct()).total).toBe(100);
  });

  it("a Pluggy deixa de mandar a parcela 2 (já no banco) — ela não volta a ser prevista", async () => {
    const r = await runSync([inst(3, "2026-12-17T00:00:00Z")], "2026-12-20T12:00:00Z");
    expect(r.created).toBe(0);
    expect((await sept()).total).toBe(100);
    expect((await oct()).total).toBe(100);
    const sep = (await prisma.upcomingInstallment.findMany()).filter((u) => u.dueDate.toISOString().startsWith("2026-09"));
    expect(sep).toHaveLength(0);
  });

  it("toda parcela da compra (lançada e prevista) tem a categoria da compra", async () => {
    const health = await integrity.runDataHealth(new Date("2026-12-20T12:00:00Z"));
    expect(health.issues.find((i) => i.id === "parcela-diferente-da-compra")).toBeUndefined();
    expect(health.issues.find((i) => i.id === "parcela-duplicada")).toBeUndefined();
  });

  it("mês fechado que muda de valor vira aviso; 'é assim mesmo' guarda o valor novo", async () => {
    const now = new Date("2026-12-20T12:00:00Z");
    await integrity.runDataHealth(now); // guarda set, out e nov
    await prisma.transaction.create({ data: { date: new Date("2026-09-20T12:00:00Z"), type: "expense", description: "Lançado atrasado", amount: 50, brokerId: broker.id } });
    const issue = (await integrity.runDataHealth(now)).issues.find((i) => i.id === "mes-fechado-mudou");
    expect(issue?.items.map((i) => i.key)).toEqual(["mes-fechado-mudou:2026-09"]);
    expect(issue?.items[0].label).toContain("Setembro/2026");
    await integrity.recordMonthTotal("2026-09");
    expect((await integrity.runDataHealth(now)).issues.find((i) => i.id === "mes-fechado-mudou")).toBeUndefined();
  });
});
