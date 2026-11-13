// Plano do primeiro milhão por ano (10/11, Luiz: "esse valor é anual... se a
// gente começou em setembro o aporte deveria ser de setembro"). O aporte
// planejado da linha do ano corrente não pode encolher a cada mês que passa.
import { describe, it, expect, vi, afterEach } from "vitest";
import { projectFirstMillion } from "../src/services/wealthProjection.js";

afterEach(() => vi.useRealTimers());

describe("projectFirstMillion — aporte planejado por ano", () => {
  it("2026 conta de setembro a dezembro, igual em outubro e em novembro", () => {
    for (const today of ["2026-10-10T12:00:00Z", "2026-11-10T12:00:00Z"]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(today));
      const { yearlyBreakdown } = projectFirstMillion(625_420, 1_000_000, 7_500, 0, { real: 16_542.17, throughMonth: 11 });
      const y2026 = yearlyBreakdown[0];
      expect(y2026).toMatchObject({ year: 2026, contribution: 30_000, fromMonth: 9, toMonth: 12, realContribution: 16_542.17, plannedSoFar: 22_500 });
      vi.useRealTimers();
    }
  });

  it("anos cheios = 12 meses; o último ano vai só até o mês em que bate a meta", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const { yearlyBreakdown, projection } = projectFirstMillion(625_420, 1_000_000, 7_500, 0, { real: 0, throughMonth: 11 });
    expect(yearlyBreakdown[1]).toMatchObject({ year: 2027, contribution: 90_000, fromMonth: 1, toMonth: 12, realContribution: null, plannedSoFar: null });
    const last = yearlyBreakdown.at(-1)!;
    expect(last.fromMonth).toBe(1);
    expect(last.contribution).toBe(7_500 * last.toMonth);
    expect(projection!.monthsToGoal).toBe(50); // (1.000.000 − 625.420) / 7.500 → 50 meses
  });
});
