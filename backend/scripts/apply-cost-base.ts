// Carrega a base do livro de custo (25/11): quantidade × preço médio do BTG
// pra cada Ação/FII. Luiz: "Use o preço médio do BTG como base para TODAS as
// ações e FIIs. Eu vou te passar preço médio e quantidade de cada posição."
//
// Uso: npx tsx scripts/apply-cost-base.ts lista.json [--desde 2026-08-01] [--apply]
//   lista.json: [{ "ticker": "DIRR3", "quantidade": 501, "precoMedio": 11.35 }, ...]
//   --desde: a partir de quando a base vale (padrão 01/08/2026, início da
//     Pluggy). Vale porque, de ago/26 até hoje, o extrato não tem compra nem
//     venda de verdade de Ação/FII (só eventos da AXIA, sem quantidade).
//   Sem --apply: só mostra o que mudaria (nada é gravado).
import { readFileSync } from "node:fs";
import { prisma } from "../src/prisma.js";
import { noonOf } from "../src/services/dates.js";
import { computeCost, monthEnd, recomputeSnapshotsFromLedger } from "../src/services/costLedger.js";

type Row = { ticker: string; quantidade: number; precoMedio: number };
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const desdeIdx = args.indexOf("--desde");
const desde = desdeIdx >= 0 ? args[desdeIdx + 1] : "2026-08-01";
if (!file) throw new Error("Passe o arquivo .json com ticker, quantidade e precoMedio");
const rows: Row[] = JSON.parse(readFileSync(file, "utf8"));
for (const r of rows) {
  if (!r.ticker || !(r.quantidade > 0) || !(r.precoMedio >= 0)) throw new Error(`Linha inválida: ${JSON.stringify(r)} (quantidade > 0 e precoMedio >= 0)`);
}
const baseDate = noonOf(desde);
const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const btg = await prisma.broker.findFirstOrThrow({ where: { name: "BTG" } });
const securities = await prisma.security.findMany({
  where: { id: { startsWith: "pluggy:" }, type: { in: ["Ação", "FII"] }, positionSnapshots: { some: { brokerId: btg.id } } },
  include: { positionSnapshots: { where: { brokerId: btg.id }, orderBy: [{ year: "asc" }, { month: "asc" }] } },
});
const live = securities.filter((s) => (s.positionSnapshots.at(-1)?.quantity ?? 0) > 0);
const byTicker = new Map(live.map((s) => [s.ticker ?? s.name, s]));

const missing = live.filter((s) => !rows.some((r) => r.ticker === (s.ticker ?? s.name)));
const unknown = rows.filter((r) => !byTicker.has(r.ticker));
if (unknown.length) console.log(`⚠ Não achei na BTG (com cotas hoje): ${unknown.map((r) => r.ticker).join(", ")}`);
if (missing.length) console.log(`⚠ Sem preço médio na lista (continuam na regra antiga): ${missing.map((s) => s.ticker ?? s.name).join(", ")}`);

console.log(`\nBase valendo desde ${desde}${apply ? "" : " — SIMULAÇÃO, nada gravado"}\n`);
for (const r of rows) {
  const sec = byTicker.get(r.ticker);
  if (!sec) continue;
  const amount = Math.round(r.quantidade * r.precoMedio * 100) / 100;
  const last = sec.positionSnapshots.at(-1)!;
  const qtyNote = Math.abs((last.quantity ?? 0) - r.quantidade) > 1e-6 ? `  ⚠ Pluggy hoje: ${last.quantity} cotas` : "";
  console.log(`${r.ticker.padEnd(7)} ${String(r.quantidade).padStart(6)} × ${brl(r.precoMedio).padStart(8)} = ${brl(amount).padStart(10)}   (hoje: ${brl(last.investedAmount)})${qtyNote}`);
  const movements = await prisma.investmentMovement.findMany({ where: { securityId: sec.id } });
  const entry = { id: "nova-base", date: baseDate, kind: "base", quantity: r.quantidade, amount, revertedAt: null };
  for (const s of sec.positionSnapshots) {
    if (s.year * 12 + s.month < baseDate.getUTCFullYear() * 12 + baseDate.getUTCMonth() + 1) continue;
    const c = computeCost([entry], movements, monthEnd(s.year, s.month));
    const after = (s.quantity ?? 0) <= 0 && s.marketValue <= 0 ? 0 : c!.invested;
    const qtyWarn = s.quantity != null && Math.abs(s.quantity - c!.quantity) > 1e-6 && s.quantity > 0 ? `  ⚠ foto tem ${s.quantity} cotas, livro ${c!.quantity}` : "";
    const pend = c!.unresolved.length ? `  (${c!.unresolved.length} evento(s) sem quantidade)` : "";
    if (Math.abs(after - s.investedAmount) >= 0.005 || qtyWarn) console.log(`          ${String(s.month).padStart(2, "0")}/${s.year}: ${brl(s.investedAmount)} → ${brl(after)}${qtyWarn}${pend}`);
  }
  if (apply) {
    await prisma.costEntry.create({
      data: {
        brokerId: btg.id,
        securityId: sec.id,
        date: baseDate,
        kind: "base",
        quantity: r.quantidade,
        unitCost: r.precoMedio,
        amount,
        source: "btg_preco_medio",
        reason: `Preço médio do BTG informado pelo Luiz (carregado em ${new Date().toISOString().slice(0, 10)})`,
      },
    });
    await recomputeSnapshotsFromLedger(sec.id);
  }
}
if (apply) console.log("\n✔ Base gravada e fotos mensais recalculadas.");
await prisma.$disconnect();
