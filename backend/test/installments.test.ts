// Parcelas futuras do cartão — casos que JÁ deram errado em produção
// (out/26). Se algum quebrar, o sync voltaria a duplicar ou sumir parcela.
import { describe, it, expect } from "vitest";
import { planInstallments, groupPurchases, effectiveDate } from "../src/services/pluggyTransactionSync.js";

type Tx = Parameters<typeof planInstallments>[0][number];
const NOW = new Date("2026-10-27T12:00:00Z");

function inst(id: string, desc: string, amount: number, n: number, total: number, purchaseDate: string, date: string, extra: Partial<Tx["creditCardMetadata"]> = {}): Tx {
  return {
    id,
    description: desc,
    amount,
    date,
    type: "DEBIT",
    status: "POSTED",
    category: null,
    creditCardMetadata: { cardNumber: "1491", installmentNumber: n, totalInstallments: total, purchaseDate, ...extra },
  } as Tx;
}

describe("groupPurchases", () => {
  it("junta a mesma compra mesmo com 3h de fuso na data da compra (C6, Bike)", () => {
    const txs = [
      inst("a", "PEOPLE BIKE", 1159, 1, 10, "2026-07-03T14:17:00.000Z", "2026-07-03T00:00:00Z"),
      inst("b", "PEOPLE BIKE", 1159, 2, 10, "2026-07-03T14:17:00.000Z", "2026-07-15T00:00:00Z"),
      inst("c", "PEOPLE BIKE", 1159, 3, 10, "2026-07-03T17:17:00.000Z", "2026-08-17T00:00:00Z"),
    ];
    expect(groupPurchases(txs, NOW)).toHaveLength(1);
  });

  it("junta parcelas com milissegundos diferentes (BTG, Usina Solar)", () => {
    const txs = [
      inst("a", "USINA", 3847.1, 6, 21, "2026-02-02T17:55:09.443Z", "2026-07-22T00:00:00Z"),
      inst("b", "USINA", 3847.1, 7, 21, "2026-02-02T17:55:09.421Z", "2026-08-22T00:00:00Z"),
    ];
    expect(groupPurchases(txs, NOW)).toHaveLength(1);
  });

  it("separa duas compras iguais feitas em dias distantes", () => {
    const txs = [
      inst("a", "AMAZON", 50, 1, 3, "2026-08-01T10:00:00.000Z", "2026-08-01T00:00:00Z"),
      inst("b", "AMAZON", 50, 1, 3, "2026-09-10T10:00:00.000Z", "2026-09-10T00:00:00Z"),
    ];
    expect(groupPurchases(txs, NOW)).toHaveLength(2);
  });
});

describe("planInstallments", () => {
  it("planeja só as parcelas DEPOIS da mais recente, no dia da compra, sem duplicar", () => {
    const txs = [
      inst("a", "PEOPLE BIKE", 1159, 1, 10, "2026-07-03T14:17:00.000Z", "2026-07-03T00:00:00Z"),
      inst("b", "PEOPLE BIKE", 1159, 2, 10, "2026-07-03T14:17:00.000Z", "2026-07-15T00:00:00Z"),
      inst("c", "PEOPLE BIKE", 1159, 3, 10, "2026-07-03T17:17:00.000Z", "2026-08-17T00:00:00Z"),
    ];
    const plan = planInstallments(txs, "broker1", NOW);
    expect(plan.map((p) => p.n)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(plan.map((p) => p.externalId)).size).toBe(plan.length);
    expect(plan[0].dueDate.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(plan.at(-1)!.dueDate.toISOString().slice(0, 10)).toBe("2027-04-03");
  });

  it("o código da compra não muda se a Pluggy mudar o fuso da última parcela", () => {
    const base = [inst("a", "X", 100, 1, 5, "2026-09-05T14:00:00.000Z", "2026-09-05T00:00:00Z")];
    const shifted = [inst("a", "X", 100, 1, 5, "2026-09-05T17:00:00.000Z", "2026-09-05T00:00:00Z")];
    expect(planInstallments(base, "b", NOW)[0].externalId).toBe(planInstallments(shifted, "b", NOW)[0].externalId);
  });

  it("compra estornada não tem parcela futura", () => {
    const txs = [
      inst("a", "AMAZON TAXCONFIG", 123.72, 1, 10, "2026-09-18T08:49:00.000Z", "2026-09-18T08:49:00.000Z"),
      { id: "r", description: "AMAZON TAXCONFIG", amount: -123.72, date: "2026-09-18T08:49:00.000Z", type: "CREDIT", status: "POSTED", category: null } as Tx,
    ];
    expect(planInstallments(txs, "b", NOW)).toHaveLength(0);
  });

  it("compra terminada não tem parcela futura", () => {
    const txs = [inst("a", "SYMPLA", 71.51, 2, 2, "2026-07-13T11:17:00.000Z", "2026-08-17T00:00:00Z")];
    expect(planInstallments(txs, "b", NOW)).toHaveLength(0);
  });

  it("parcela de mês futuro mandada pelo banco não vira 'a mais recente' (BTG)", () => {
    const txs = [
      inst("a", "USINA", 3847.1, 9, 21, "2026-02-02T17:55:09.000Z", "2026-10-02T00:00:00Z"),
      inst("f", "USINA", 3847.1, 15, 21, "2026-02-02T17:55:09.000Z", "2026-02-03T00:00:00Z"),
    ];
    const plan = planInstallments(txs, "b", NOW);
    expect(plan[0].n).toBe(10);
    expect(plan).toHaveLength(12);
  });

  it("nunca planeja parcela antes do mês passado", () => {
    const txs = [inst("a", "ANTIGA", 10, 1, 12, "2026-01-10T10:00:00.000Z", "2026-01-10T00:00:00Z")];
    const plan = planInstallments(txs, "b", NOW);
    expect(plan.every((p) => p.dueDate >= new Date("2026-09-01T00:00:00Z"))).toBe(true);
  });
});

describe("effectiveDate", () => {
  it("parcela N cai no dia da compra, N−1 meses depois", () => {
    const tx = inst("a", "X", 1, 4, 10, "2026-07-03T14:17:00.000Z", "2026-08-17T00:00:00Z");
    expect(effectiveDate(tx).toISOString().slice(0, 10)).toBe("2026-10-03");
  });
  it("compra no dia 31 cai no último dia de meses mais curtos", () => {
    const tx = inst("a", "X", 1, 2, 3, "2026-01-31T12:00:00.000Z", "2026-02-17T00:00:00Z");
    expect(effectiveDate(tx).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
