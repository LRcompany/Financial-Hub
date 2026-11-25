import { describe, it, expect } from "vitest";
import { redactPluggy } from "../src/mcp/detailTools.js";

describe("redactPluggy", () => {
  it("oculta documento, titular e segredos e encurta números de conta", () => {
    const out = redactPluggy({
      owner: "FULANO",
      taxNumber: "123",
      webhookUrl: "https://x/?secret=1",
      number: "00546989-7",
      bankData: { transferNumber: "208/0001/00546989-7" },
      paymentData: { payer: { documentNumber: { value: "1" } } },
      list: [{ issuerCNPJ: "9", name: "KNCR11", cardNumber: null }],
    });
    expect(out.owner).toBe("[oculto]");
    expect(out.taxNumber).toBe("[oculto]");
    expect(out.webhookUrl).toBe("[oculto]");
    expect(out.number).toBe("…89-7");
    expect(out.bankData.transferNumber).toBe("…89-7");
    expect(out.paymentData.payer.documentNumber).toBe("[oculto]");
    expect(out.list[0]).toEqual({ issuerCNPJ: "[oculto]", name: "KNCR11", cardNumber: null });
  });
});
