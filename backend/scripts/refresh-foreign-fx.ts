// Recota as fotos de Nomad/Wise pelo dólar de fechamento do mês (mês corrente:
// dólar do dia) — ver services/foreignFx.ts. O agendador já faz isso todo dia
// às 21:00 UTC; este script é pra rodar na mão e ver o antes → depois.
//
// Uso: npx tsx scripts/refresh-foreign-fx.ts [--desde 2026-09] [--apply]
//   Sem --apply: só mostra o que mudaria (nada é gravado).
import { prisma } from "../src/prisma.js";
import { refreshForeignSnapshotFx, FX_CLOSE_START_YM } from "../src/services/foreignFx.js";
import { yearMonth } from "../src/services/activePositions.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const i = args.indexOf("--desde");
const fromYm = i >= 0 ? yearMonth(Number(args[i + 1].slice(0, 4)), Number(args[i + 1].slice(5, 7))) : FX_CLOSE_START_YM;
const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const { changes, skipped } = await refreshForeignSnapshotFx({ apply, fromYm });
console.log(apply ? "Gravado:\n" : "SIMULAÇÃO — nada gravado:\n");
const byMonth = new Map<string, typeof changes>();
for (const c of changes) {
  const k = `${String(c.month).padStart(2, "0")}/${c.year}`;
  byMonth.set(k, [...(byMonth.get(k) ?? []), c]);
}
for (const [k, list] of byMonth) {
  const before = list.reduce((s, c) => s + c.marketBefore, 0);
  const after = list.reduce((s, c) => s + c.marketAfter, 0);
  console.log(`${k} (dólar de ${list[0].rateDay}, ${list[0].rateSource}): ${brl(before)} → ${brl(after)} (${after - before >= 0 ? "+" : ""}${brl(after - before)})`);
  for (const c of list) console.log(`   ${c.broker.padEnd(6)} ${c.asset.padEnd(28)} ${c.rateBefore.toFixed(4)} → ${c.rateAfter.toFixed(4)}   ${brl(c.marketBefore)} → ${brl(c.marketAfter)}`);
}
if (!changes.length) console.log("Nada a recotar.");
for (const s of skipped) console.log(`⚠ ${s}`);
await prisma.$disconnect();
