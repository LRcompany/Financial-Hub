// Aplicação/resgate real e taxa com indexador (17/11) — ver services/investmentFlows.ts.
import { describe, it, expect } from "vitest";
import { rateLabel, movementFromPluggy, isFlowFed, isPostFixed } from "../src/services/investmentFlows.js";

describe("rateLabel", () => {
  it("CDB do Sofisa: taxa 0 + 105 do CDI vira '105% do CDI'", () => {
    expect(rateLabel({ fixedAnnualRate: 0, rate: 105, rateType: "CDI" })).toBe("105% do CDI");
  });
  it("Tesouro Selic, IPCA+ e prefixado", () => {
    expect(rateLabel({ fixedAnnualRate: 0.11, rate: 0.14, rateType: "SELIC" })).toBe("Selic + 0,11% a.a.");
    expect(rateLabel({ fixedAnnualRate: 7.3, rate: 100, rateType: "IPCA" })).toBe("IPCA + 7,3% a.a.");
    expect(rateLabel({ fixedAnnualRate: 15.3, rate: 0, rateType: null })).toBe("15,3% a.a.");
    expect(rateLabel({ fixedAnnualRate: 2, rate: 100, rateType: "CDI" })).toBe("CDI + 2% a.a.");
  });
  it("bond manual: cupom no nome; sem nada, null (vira aviso na Saúde dos dados)", () => {
    expect(rateLabel({ fixedAnnualRate: null, rate: null, rateType: null, name: "BRAZIL (FEDERATIVE REPUBLIC) 6.25%, 03/18/2031" })).toBe("cupom 6,25% a.a.");
    expect(rateLabel({ fixedAnnualRate: 0, rate: 0, rateType: null, name: "CDB - BANCO X" })).toBeNull();
  });
});

describe("movementFromPluggy", () => {
  it("BUY = aplicação, SELL = resgate, provento e evento sem dinheiro não são aporte", () => {
    expect(movementFromPluggy({ type: "BUY", amount: 2796.12, quantity: 0.14 })).toEqual({ kind: "aplicacao", amount: 2796.12 });
    expect(movementFromPluggy({ type: "SELL", amount: 9843.02, quantity: 9369 })).toEqual({ kind: "resgate", amount: 9843.02 });
    expect(movementFromPluggy({ type: "INTEREST", amount: 65.51, quantity: null })).toBeNull();
    expect(movementFromPluggy({ type: "BUY", amount: 0, quantity: 3 })).toBeNull();
  });
});

describe("quem usa movimentação real no aporte", () => {
  it("só Renda Fixa e Fundo de corretora conectada", () => {
    expect(isFlowFed({ dataSource: "pluggy" }, "Renda Fixa")).toBe(true);
    expect(isFlowFed({ dataSource: "pluggy" }, "Fundo")).toBe(true);
    expect(isFlowFed({ dataSource: "pluggy" }, "Ação")).toBe(false);
    expect(isFlowFed({ dataSource: "pluggy" }, "Conta Corrente")).toBe(false);
    expect(isFlowFed({ dataSource: "manual_statement" }, "Renda Fixa")).toBe(false);
  });
  it("pós-fixado = Selic ou CDI", () => {
    expect(isPostFixed({ rateType: "SELIC" })).toBe(true);
    expect(isPostFixed({ rateType: "CDI" })).toBe(true);
    expect(isPostFixed({ rateType: "IPCA" })).toBe(false);
  });
});
