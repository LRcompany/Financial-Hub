// Migração única (27/10): toda data de gasto/recebimento/pagamento vira "dia
// do calendário no Brasil ao meio-dia UTC" (ver src/services/dates.ts).
// Regra pro dado antigo: meia-noite UTC exata = data digitada (vale o dia
// digitado); qualquer outro horário (ou vindo da Pluggy) = horário real (vale
// o dia no Brasil). Uso: `npx tsx scripts/migrate-calendar-dates.ts` simula;
// `--apply` grava.
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { brCalendarDay, noonOf, isCalendarNoon } from "../src/services/dates.js";

const apply = process.argv.includes("--apply");
const isUtcMidnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
const normalize = (d: Date, fromPluggy = false) => (!fromPluggy && isUtcMidnight(d) ? noonOf(d.toISOString().slice(0, 10)) : brCalendarDay(d));

type Change = { table: string; id: string; from: Date; to: Date; label: string };
const changes: Change[] = [];
const plan = (table: string, id: string, from: Date | null, to: Date, label: string) => {
  if (from && !isCalendarNoon(from)) changes.push({ table, id, from, to, label });
};

for (const t of await prisma.transaction.findMany({ select: { id: true, date: true, source: true, description: true, amount: true } }))
  plan("Transaction", t.id, t.date, normalize(t.date, t.source === "pluggy"), `${t.description} R$${t.amount}`);
for (const u of await prisma.upcomingInstallment.findMany({ select: { id: true, dueDate: true, description: true, externalId: true } }))
  plan("UpcomingInstallment", u.id, u.dueDate, normalize(u.dueDate, !!u.externalId), u.description);
for (const r of await prisma.projectReceipt.findMany({ select: { id: true, paymentDate: true } })) plan("ProjectReceipt", r.id, r.paymentDate, normalize(r.paymentDate), "recebimento");
for (const r of await prisma.supplierPayment.findMany({ select: { id: true, paymentDate: true } })) plan("SupplierPayment", r.id, r.paymentDate, normalize(r.paymentDate), "fornecedor");
for (const r of await prisma.taxPayment.findMany({ select: { id: true, paymentDate: true } })) plan("TaxPayment", r.id, r.paymentDate, normalize(r.paymentDate), "DAS");
for (const r of await prisma.contribution.findMany({ select: { id: true, date: true } })) plan("Contribution", r.id, r.date, normalize(r.date), "aporte");
for (const p of await prisma.project.findMany({ select: { id: true, startDate: true, endDate: true, name: true } })) {
  plan("Project.startDate", p.id, p.startDate, normalize(p.startDate), p.name);
  if (p.endDate) plan("Project.endDate", p.id, p.endDate, normalize(p.endDate), p.name);
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const byTable = new Map<string, { total: number; dayChanged: number }>();
for (const c of changes) {
  const cur = byTable.get(c.table) ?? { total: 0, dayChanged: 0 };
  cur.total++;
  if (day(c.from) !== day(c.to)) cur.dayChanged++;
  byTable.set(c.table, cur);
}
console.log(apply ? "APLICANDO" : "SIMULAÇÃO", Object.fromEntries(byTable));
const moved = changes.filter((c) => day(c.from) !== day(c.to) && c.from >= new Date("2026-09-01"));
console.log(`Mudam de dia desde set/26: ${moved.length}`);
for (const c of moved.slice(0, 30)) console.log(`  ${c.table} ${day(c.from)} -> ${day(c.to)}${c.from.getUTCMonth() !== c.to.getUTCMonth() ? " (MUDA DE MÊS)" : ""} ${c.label}`);

if (apply) {
  for (const c of changes) {
    const data = { date: c.to };
    if (c.table === "Transaction") await prisma.transaction.update({ where: { id: c.id }, data });
    else if (c.table === "UpcomingInstallment") await prisma.upcomingInstallment.update({ where: { id: c.id }, data: { dueDate: c.to } });
    else if (c.table === "ProjectReceipt") await prisma.projectReceipt.update({ where: { id: c.id }, data: { paymentDate: c.to } });
    else if (c.table === "SupplierPayment") await prisma.supplierPayment.update({ where: { id: c.id }, data: { paymentDate: c.to } });
    else if (c.table === "TaxPayment") await prisma.taxPayment.update({ where: { id: c.id }, data: { paymentDate: c.to } });
    else if (c.table === "Contribution") await prisma.contribution.update({ where: { id: c.id }, data });
    else if (c.table === "Project.startDate") await prisma.project.update({ where: { id: c.id }, data: { startDate: c.to } });
    else if (c.table === "Project.endDate") await prisma.project.update({ where: { id: c.id }, data: { endDate: c.to } });
  }
  console.log("gravado:", changes.length);
}
await prisma.$disconnect();
