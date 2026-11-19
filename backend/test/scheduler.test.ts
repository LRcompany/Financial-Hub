// Sync diário de investimentos (17/11) — sempre às 21:00 UTC (18:00 de Brasília).
import { describe, it, expect } from "vitest";
import { msUntilUtcHour } from "../src/services/scheduler.js";

describe("msUntilUtcHour", () => {
  it("mesmo dia se ainda não passou, dia seguinte se já passou", () => {
    expect(msUntilUtcHour(21, new Date("2026-11-17T12:55:00Z"))).toBe((8 * 60 + 5) * 60_000);
    expect(msUntilUtcHour(21, new Date("2026-11-30T21:00:00Z"))).toBe(24 * 3600_000);
    expect(new Date(new Date("2026-11-30T22:00:00Z").getTime() + msUntilUtcHour(21, new Date("2026-11-30T22:00:00Z"))).toISOString()).toBe("2026-12-01T21:00:00.000Z");
  });
});
