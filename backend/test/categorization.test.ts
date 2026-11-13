// Texto genérico do cartão não diz quem vendeu (13/11) — nunca vira regra de
// categoria (achado real: "Compra a Vista sem Juros MasterCard" foi tudo pra
// Supermercado depois de UMA compra categorizada assim).
import { describe, it, expect } from "vitest";
import { isGenericDescription } from "../src/services/categorization.js";

describe("isGenericDescription", () => {
  it("reconhece os textos genéricos do C6", () => {
    expect(isGenericDescription("Compra a Vista sem Juros MasterCard")).toBe(true);
    expect(isGenericDescription("Parcela de compra lojista MasterCard")).toBe(true);
    expect(isGenericDescription("MASTERCARD")).toBe(true);
    expect(isGenericDescription("MASTERCARD INTERNACIONAL")).toBe(true);
  });
  it("lojista de verdade continua aprendendo", () => {
    expect(isGenericDescription("UNI COMPRA SUPERMERC   MACEIO        BRA")).toBe(false);
    expect(isGenericDescription("BELLACOMPRA            MACEIO        BRA")).toBe(false);
    expect(isGenericDescription("MASTERCARD STORE SAO PAULO")).toBe(false);
  });
});
