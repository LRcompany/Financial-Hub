// Categoria dada enquanto o nome era genérico (19/11) — ver categoryAfterRename.
import { describe, it, expect } from "vitest";
import { categoryAfterRename } from "../src/services/pluggyTransactionSync.js";

const UBER = "cat-uber";
const SUPER = "cat-supermercado";

describe("categoryAfterRename", () => {
  it("Uber que chegou como 'Compra a Vista sem Juros' e caiu em Supermercado vai pra regra do Uber", () => {
    expect(categoryAfterRename({ description: "Compra a Vista sem Juros MasterCard", categoryId: SUPER, purchaseId: null }, "UBER UBER *TRIP HELP.U", UBER)).toBe(UBER);
    expect(categoryAfterRename({ description: "MASTERCARD", categoryId: "cat-farmacia", purchaseId: null }, "UBER * PENDING SAO PAULO", UBER)).toBe(UBER);
  });
  it("sem regra pro lojista real, fica a categoria que estava", () => {
    expect(categoryAfterRename({ description: "MASTERCARD", categoryId: SUPER, purchaseId: null }, "LOJA NOVA", null)).toBe(SUPER);
  });
  it("nome que já era real nunca perde a categoria do Luiz", () => {
    expect(categoryAfterRename({ description: "UBER *TRIP", categoryId: "cat-trabalho", purchaseId: null }, "UBER UBER *TRIP HELP.U", UBER)).toBe("cat-trabalho");
  });
  it("compra parcelada: categoria é da compra, não muda", () => {
    expect(categoryAfterRename({ description: "Parcela de compra lojista MasterCard", categoryId: SUPER, purchaseId: "p1" }, "LOJA X", UBER)).toBe(SUPER);
  });
  it("sem categoria, usa a regra", () => {
    expect(categoryAfterRename({ description: "MASTERCARD", categoryId: null, purchaseId: null }, "UBER *TRIP", UBER)).toBe(UBER);
  });
});
