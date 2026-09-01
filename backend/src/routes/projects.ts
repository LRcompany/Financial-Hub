import { Router } from "express";
import { prisma } from "../prisma.js";

export const projectsRouter = Router();

function monthRange(year: number, month: number) {
  return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
}

// GET /api/projects-summary?year=2026
// Status financeiro dos projetos — tudo somado a partir de ProjectReceipt,
// TaxPayment e Project, sem número fixo.
projectsRouter.get("/projects-summary", async (req, res) => {
  const now = new Date();
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const lastMonthDate = new Date(year, month - 2, 1);

  const [receivedThisMonthAgg, receivedLastMonthAgg, receivedThisYearAgg, taxAgg, allReceipts, projects] =
    await Promise.all([
      prisma.projectReceipt.aggregate({ where: { paymentDate: monthRange(year, month) }, _sum: { amount: true } }),
      prisma.projectReceipt.aggregate({
        where: { paymentDate: monthRange(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1) },
        _sum: { amount: true },
      }),
      prisma.projectReceipt.aggregate({
        where: { paymentDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
        _sum: { amount: true },
      }),
      prisma.taxPayment.aggregate({ where: { competenceYear: year }, _sum: { amountPaid: true } }),
      prisma.projectReceipt.findMany({ include: { project: { include: { client: true } } } }),
      prisma.project.findMany({ include: { client: true, receipts: true } }),
    ]);

  // média mensal dos últimos 12 meses e série pra gráfico
  const monthlyReceived: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const total = allReceipts
      .filter((r) => r.paymentDate >= d && r.paymentDate < new Date(d.getFullYear(), d.getMonth() + 1, 1))
      .reduce((sum, r) => sum + r.amount, 0);
    monthlyReceived.push({ label: d.toLocaleDateString("pt-BR", { month: "short" }), value: total });
  }
  const monthsWithData = monthlyReceived.filter((m) => m.value > 0).length || 1;
  const avgMonthly12m = monthlyReceived.reduce((sum, m) => sum + m.value, 0) / monthsWithData;

  // saldo a receber = valor de contrato - já recebido, projetos não cancelados
  const openProjects = projects.filter((p) => p.status !== "cancelado");
  const outstanding = openProjects.reduce((sum, p) => {
    const received = p.receipts.reduce((s, r) => s + r.amount, 0);
    return sum + Math.max(0, p.contractValue - received);
  }, 0);
  const receivedThisMonth = receivedThisMonthAgg._sum.amount ?? 0;
  // aproximação: "a receber" antes dos recebimentos deste mês
  const outstandingLastMonth = outstanding + receivedThisMonth;

  // receita por cliente no ano
  const clientRevenueMap = new Map<string, number>();
  for (const r of allReceipts) {
    if (r.paymentDate.getFullYear() !== year) continue;
    const name = r.project.client.name;
    clientRevenueMap.set(name, (clientRevenueMap.get(name) ?? 0) + r.amount);
  }
  const clientRevenue = [...clientRevenueMap.entries()].map(([label, value]) => ({ label, value }));

  const activeProjects = projects
    .filter((p) => p.status === "em_andamento")
    .map((p) => ({
      id: p.id,
      name: p.name,
      client: p.client.name,
      status: p.status,
      contractValue: p.contractValue,
      received: p.receipts.reduce((s, r) => s + r.amount, 0),
    }));

  // Projeto que mais recebeu especificamente NO MÊS pedido (não all-time —
  // usado no resumo mensal, "o projeto que mais rendeu em agosto").
  const receivedByProjectThisMonth = new Map<string, number>();
  const monthRangeReq = monthRange(year, month);
  for (const r of allReceipts) {
    if (r.paymentDate < monthRangeReq.gte || r.paymentDate >= monthRangeReq.lt) continue;
    const name = r.project.name;
    receivedByProjectThisMonth.set(name, (receivedByProjectThisMonth.get(name) ?? 0) + r.amount);
  }
  const bestProjectThisMonth =
    [...receivedByProjectThisMonth.entries()]
      .map(([name, received]) => ({ name, received }))
      .sort((a, b) => b.received - a.received)[0] ?? null;

  res.json({
    receivedThisMonth,
    receivedLastMonth: receivedLastMonthAgg._sum.amount ?? 0,
    receivedThisYear: receivedThisYearAgg._sum.amount ?? 0,
    avgMonthly12m,
    taxPaidThisYear: taxAgg._sum.amountPaid ?? 0,
    outstanding,
    outstandingLastMonth,
    monthlyReceived,
    clientRevenue,
    activeProjects,
    bestProjectThisMonth,
  });
});
