// Dólar de fechamento (25/11) — ver services/foreignFx.ts.
import { describe, it, expect } from "vitest";
import { rerate, closingCandidates } from "../src/services/foreignFx.js";

describe("dólar de fechamento", () => {
  it("recota a foto da Nomad de out/26 (AOK) de 5,0906 pra 5,4397 sem mudar o valor em dólar", () => {
    const r = rerate({ marketValue: 28543.66, unitValue: null, fxRateToBRL: 5.0906 }, 5.4397);
    expect(r.marketValue).toBeCloseTo(30501.1, 1);
    expect(r.marketValue / 5.4397).toBeCloseTo(28543.66 / 5.0906, 6);
    expect(r.fxRateToBRL).toBe(5.4397);
    expect(r.unitValue).toBeNull();
  });
  it("fechamento procura do último dia do mês pra trás (31/10/2026 é sábado)", () => {
    expect(closingCandidates(2026, 10, 3)).toEqual(["2026-10-31", "2026-10-30", "2026-10-29"]);
    expect(closingCandidates(2026, 2, 1)).toEqual(["2026-02-28"]);
  });
});
