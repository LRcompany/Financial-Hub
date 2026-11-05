// Datas = dia do calendário brasileiro ao meio-dia UTC (27/10). Se quebrar,
// gasto da noite volta a cair no dia/mês seguinte.
import { describe, it, expect } from "vitest";
import { brCalendarDay, parseCalendarInput, isCalendarNoon } from "../src/services/dates.js";

const iso = (d: Date) => d.toISOString();

describe("datas do calendário brasileiro", () => {
  it("gasto às 22h de Brasília no último dia do mês fica no mês certo", () => {
    expect(iso(brCalendarDay("2026-08-01T00:51:00.000Z"))).toBe("2026-07-31T12:00:00.000Z");
  });
  it("meia-noite de Brasília (03:00 UTC, padrão da Pluggy) é o mesmo dia", () => {
    expect(iso(brCalendarDay("2026-10-05T03:00:00.000Z"))).toBe("2026-10-05T12:00:00.000Z");
  });
  it("data digitada vale como o dia digitado", () => {
    expect(iso(parseCalendarInput("2026-10-01"))).toBe("2026-10-01T12:00:00.000Z");
  });
  it("resultado está sempre no padrão de meio-dia", () => {
    expect(isCalendarNoon(brCalendarDay(new Date()))).toBe(true);
  });
});
