// Meta diária (20/11) — ver services/dailyAllowance.ts.
import { describe, it, expect } from "vitest";
import { freeToSpendToday, goalSpendOfDay, installmentShare, countsForDailyGoal, type DailyItem } from "../src/services/dailyAllowance.js";

describe("livre pra gastar hoje", () => {
  it("parcela de R$80 num mês de 30 dias baixa a meta de R$150 pra R$147,33", () => {
    const items: DailyItem[] = [{ day: 10, amount: 80, isInstallment: true, counts: true }];
    expect(freeToSpendToday(150, 30, 1, items)).toBeCloseTo(147.33, 2);
  });
  it("o dia em que a parcela cai não fica vermelho: pesa só a fatia diluída", () => {
    const items: DailyItem[] = [{ day: 10, amount: 80, isInstallment: true, counts: true }];
    const share = installmentShare(items, 30);
    expect(goalSpendOfDay(items, 10, share)).toBeCloseTo(2.67, 2);
    expect(goalSpendOfDay(items, 10, share)).toBeLessThan(150);
  });
  it("aluguel/contas (fora da meta) não mexem; gasto até ontem divide pelos dias que faltam, contando hoje", () => {
    const items: DailyItem[] = [
      { day: 5, amount: 4400, isInstallment: false, counts: false }, // aluguel
      { day: 3, amount: 300, isInstallment: false, counts: true },
      { day: 11, amount: 999, isInstallment: false, counts: true }, // hoje: não entra no "até ontem"
    ];
    // (150×30 − 300) ÷ (30 − 11 + 1)
    expect(freeToSpendToday(150, 30, 11, items)).toBeCloseTo(210, 2);
  });
  it("estourou: fica negativo (tela mostra 'passou R$ X')", () => {
    const items: DailyItem[] = [{ day: 2, amount: 5000, isInstallment: false, counts: true }];
    expect(freeToSpendToday(150, 30, 30, items)).toBeCloseTo(-500, 2);
  });
});

describe("categoria conta pra meta diária", () => {
  const byId = new Map([
    ["usina", { countsForDailyGoal: false, parentId: null }],
    ["usina-custo", { countsForDailyGoal: true, parentId: "usina" }],
    ["mercado", { countsForDailyGoal: true, parentId: "alimentacao" }],
    ["alimentacao", { countsForDailyGoal: true, parentId: null }],
  ]);
  it("mãe fora tira a filha junto; sem categoria conta", () => {
    expect(countsForDailyGoal("usina-custo", byId)).toBe(false);
    expect(countsForDailyGoal("mercado", byId)).toBe(true);
    expect(countsForDailyGoal(null, byId)).toBe(true);
  });
});
