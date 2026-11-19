// Confere a parte de investimento (17/11): sincroniza as corretoras da Pluggy
// (só com --sync), depois imprime aporte e rendimento por mês, as
// movimentações do mês e os avisos novos da Saúde dos dados.
//   npx tsx scripts/check-investments.ts [--sync]
import "dotenv/config";
import express from "express";
import { prisma } from "../src/prisma.js";
import { syncBrokerInvestments } from "../src/services/pluggySync.js";
import { wealthRouter } from "../src/routes/wealth.js";
import { positionsRouter } from "../src/routes/positions.js";
import { runDataHealth } from "../src/services/integrity.js";

const brl = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

if (process.argv.includes("--sync")) {
  const brokers = await prisma.broker.findMany({ where: { dataSource: "pluggy", archivedAt: null, pluggyConnectorId: { not: null } } });
  for (const b of brokers) {
    const r = await syncBrokerInvestments(b.id, b.pluggyConnectorId!);
    console.log(`sync ${b.name}: ${r.investmentsCount} posições, ${r.movementsSynced} movimentações`);
  }
}

const app = express();
app.use(wealthRouter);
app.use(positionsRouter);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`).then((r) => r.json() as Promise<any>);

for (const [month, year] of [[10, 2026], [11, 2026]]) {
  const w = await get(`/wealth-overview?month=${month}&year=${year}`);
  console.log(`\n== ${month}/${year} total ${brl(w.total)} | aporte do mês ${brl(w.investedThisMonth)} | retorno médio ${w.avgMonthlyReturnPct?.toFixed(3)}%`);
  for (const m of w.investedByMonth.slice(-3)) {
    console.log(`  ${m.label}: aporte ${brl(m.value)} | rendimento ${brl(m.returnValue)}`);
    for (const d of m.breakdown) console.log(`     ${d.label}: ${brl(d.value)}`);
  }
  console.log("  movimentações:");
  for (const m of w.movementsThisMonth) console.log(`     ${m.date} ${m.broker} ${m.asset} ${m.kind} ${brl(m.amount)} (${m.source})`);
}

const pos = await get(`/positions`);
console.log("\n== renda fixa BTG/Sofisa");
for (const g of pos.byType) for (const p of g.positions) if (g.type === "Renda Fixa" && ["BTG", "Sofisa"].includes(p.broker)) console.log(`  ${p.broker} ${p.name} inv ${brl(p.investedAmount)} mkt ${brl(p.marketValue)} taxa ${p.rateLabel}`);

const health = await runDataHealth();
console.log("\n== saúde dos dados (investimento)");
for (const i of health.issues.filter((x) => ["investido-caiu-sem-resgate", "renda-fixa-sem-taxa", "rendimento-negativo-pos-fixado"].includes(x.id))) {
  console.log(`  ${i.title} (${i.total})`);
  for (const it of i.items) console.log(`     ${it.label}`);
}
server.close();
await prisma.$disconnect();
