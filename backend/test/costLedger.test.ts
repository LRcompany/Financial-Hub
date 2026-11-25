// Livro de custo (25/11) — ver services/costLedger.ts.
import { describe, it, expect } from "vitest";
import { computeCost, type LedgerEntry, type LedgerMovement } from "../src/services/costLedger.js";

const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);
const base = (d: string, quantity: number, unitCost: number): LedgerEntry => ({
  id: `b-${d}`,
  date: noon(d),
  kind: "base",
  quantity,
  amount: quantity * unitCost,
  revertedAt: null,
});
const mv = (d: string, kind: string, amount: number, quantity: number | null): LedgerMovement => ({ id: `m-${d}-${kind}`, date: noon(d), kind, amount, quantity });
const END = noon("2027-01-01");

describe("livro de custo", () => {
  it("sem base devolve null (posição continua na regra antiga)", () => {
    expect(computeCost([], [mv("2026-09-01", "aplicacao", 100, 10)], END)).toBeNull();
  });

  it("base = cotas × preço médio do BTG (DIRR3: 501 × 11,35)", () => {
    const c = computeCost([base("2026-08-01", 501, 11.35)], [], END)!;
    expect(c.invested).toBeCloseTo(5686.35, 2);
    expect(c.quantity).toBe(501);
    expect(c.origin).toBe("preco_medio_btg");
  });

  it("compra soma; venda desconta pelo custo médio das cotas vendidas", () => {
    const c = computeCost(
      [base("2026-08-01", 100, 10)], // 1.000
      [mv("2026-09-10", "aplicacao", 600, 50), mv("2026-10-05", "resgate", 900, 60)], // 150 cotas a 10,6667 → vende 60 = 640
      END
    )!;
    expect(c.quantity).toBe(90);
    expect(c.invested).toBeCloseTo(960, 2); // 1.600 − 640 (o lucro da venda não entra no custo)
    expect(c.origin).toBe("movimentacao");
  });

  it("movimento antes ou no dia da base não conta (a base já inclui)", () => {
    const c = computeCost([base("2026-08-01", 100, 10)], [mv("2026-07-15", "aplicacao", 500, 50), mv("2026-08-01", "aplicacao", 500, 50)], END)!;
    expect(c.invested).toBe(1000);
  });

  it("evento sem quantidade (troca de classe, bonificação) não mexe no custo e fica pendente", () => {
    const c = computeCost([base("2026-08-01", 189, 49.34)], [mv("2026-09-16", "resgate", 330.66, null), mv("2026-09-16", "aplicacao", 329.64, null)], END)!;
    expect(c.invested).toBeCloseTo(189 * 49.34, 2);
    expect(c.unresolved).toHaveLength(2);
  });

  it("ajuste soma no custo; ajuste desfeito (revertedAt) é ignorado", () => {
    const adj: LedgerEntry = { id: "a1", date: noon("2026-10-10"), kind: "ajuste", quantity: null, amount: -120.67, revertedAt: null };
    const undone: LedgerEntry = { ...adj, id: "a2", amount: 5000, revertedAt: noon("2026-10-11") };
    const c = computeCost([base("2026-08-01", 233, 21.77), adj, undone], [], END)!;
    expect(c.invested).toBeCloseTo(233 * 21.77 - 120.67, 2);
    expect(c.origin).toBe("ajuste");
  });

  it("vendeu tudo: cotas e custo zero", () => {
    const c = computeCost([base("2026-08-01", 10, 10)], [mv("2026-09-01", "resgate", 150, 10)], END)!;
    expect(c.quantity).toBe(0);
    expect(c.invested).toBe(0);
  });

  it("calcula até a data pedida (foto de cada mês)", () => {
    const entries = [base("2026-08-01", 100, 10)];
    const moves = [mv("2026-11-10", "aplicacao", 500, 50)];
    expect(computeCost(entries, moves, noon("2026-11-01"))!.invested).toBe(1000);
    expect(computeCost(entries, moves, noon("2026-12-01"))!.invested).toBe(1500);
  });
});
