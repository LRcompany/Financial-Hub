// Lança à mão uma aplicação/resgate de corretora conectada que a Pluggy ainda
// não trouxe (17/11 — ver InvestmentMovement). Some sozinha quando a da Pluggy
// chegar (mesmo ativo e tipo, valor e data próximos — dropSupersededManualMovements).
//   npx tsx scripts/add-movement.ts --security <id> --date 2026-11-13 --kind aplicacao --amount 2829.57 --note "..." [--apply]
import "dotenv/config";
import { prisma } from "../src/prisma.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const securityId = arg("security");
const date = arg("date");
const kind = arg("kind");
const amount = Number(arg("amount"));
const note = arg("note") ?? null;
if (!securityId || !date || (kind !== "aplicacao" && kind !== "resgate") || !(amount > 0)) {
  console.error("uso: --security <id> --date AAAA-MM-DD --kind aplicacao|resgate --amount <valor> [--note ...] [--apply]");
  process.exit(1);
}
const snap = await prisma.positionSnapshot.findFirst({ where: { securityId }, include: { broker: true, security: true }, orderBy: [{ year: "desc" }, { month: "desc" }] });
if (!snap) throw new Error(`ativo ${securityId} não encontrado`);
const data = { brokerId: snap.brokerId, securityId, date: new Date(`${date}T12:00:00Z`), kind, amount, source: "manual", note };
console.log(`${snap.broker.name} · ${snap.security.name}: ${kind} de R$ ${amount.toFixed(2)} em ${date}${note ? ` (${note})` : ""}`);
if (process.argv.includes("--apply")) {
  const m = await prisma.investmentMovement.create({ data });
  console.log(`gravado ${m.id}`);
} else console.log("(dry-run — passe --apply pra gravar)");
await prisma.$disconnect();
