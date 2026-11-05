// Uma vez (05/11): cria a compra (`Purchase`) de cada compra parcelada que já
// existe e liga a ela as parcelas lançadas e previstas, com a categoria/nota
// da compra (ver services/purchases.ts). Mesmo caminho do sync de todo dia
// (`reconcileInstallments` + `linkManualPurchases`), então depois disso o
// sync já mantém tudo sozinho.
// Sem --apply só mostra o que faria, e os totais de set/out/nov antes e depois.
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { getAccounts, getTransactions } from "../src/services/pluggy.js";
import { reconcileInstallments } from "../src/services/pluggyTransactionSync.js";
import { linkManualPurchases } from "../src/services/purchases.js";
import { monthTotalNow } from "../src/services/integrity.js";

const apply = process.argv.includes("--apply");
const MONTHS = ["2026-09", "2026-10", "2026-11"];
const totals = async () => Object.fromEntries(await Promise.all(MONTHS.map(async (ym) => [ym, (await monthTotalNow(ym)).total])));

const before = await totals();
const brokers = await prisma.broker.findMany({ where: { dataSource: "pluggy", pluggyConnectorId: { not: null }, archivedAt: null } });
for (const broker of brokers) {
  const { results: accounts } = (await getAccounts(broker.pluggyConnectorId!)) as { results: { id: string; type: string }[] };
  const credit = accounts.filter((a) => a.type === "CREDIT");
  if (credit.length === 0) continue;
  const all = [];
  for (const a of credit) all.push(...((await getTransactions(a.id)) as { results: unknown[] }).results);
  const r = await reconcileInstallments(all as Parameters<typeof reconcileInstallments>[0], broker, { dryRun: !apply });
  console.log(`\n== ${broker.name}: ${r.created} cria, ${r.updated} ajusta, ${r.deleted} apaga`);
  for (const line of r.log) console.log(`  ${line}`);
}
const manual = await linkManualPurchases({ dryRun: !apply });
console.log(`\n== Parcelas digitadas: ${manual.length} compra(s)`);
for (const line of manual) console.log(`  ${line}`);

const after = await totals();
console.log("\nTotais:", MONTHS.map((ym) => `${ym} ${before[ym]} → ${after[ym]}`).join(" | "));
console.log(apply ? "Aplicado." : "Só simulação — rode com --apply.");
process.exit(0);
