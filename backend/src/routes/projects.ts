import { Router } from "express";
import { prisma } from "../prisma.js";

export const projectsRouter = Router();

function monthRange(year: number, month: number) {
  return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
}

// ---------- categorias de ponte (Projetos → Orçamento) ----------
// Todo evento real de Projetos (recebimento, pagamento a fornecedor, DAS)
// também vira uma Transaction — é assim que "projetos traz as entradas pro
// Command" sem duplicar lançamento manual. As categorias são criadas sob
// demanda na primeira vez que precisam existir.

async function getOrCreateClientIncomeCategory(clientName: string) {
  const existing = await prisma.category.findFirst({ where: { name: clientName, type: "income" } });
  if (existing) return existing;
  let parent = await prisma.category.findFirst({ where: { name: "Projetos", type: "income", parentId: null } });
  if (!parent) {
    parent = await prisma.category.create({ data: { name: "Projetos", type: "income", kind: "non_essential" } });
  }
  return prisma.category.create({ data: { name: clientName, type: "income", kind: "non_essential", parentId: parent.id } });
}

async function getOrCreateSupplierExpenseCategory() {
  const existing = await prisma.category.findFirst({ where: { name: "Fornecedores", type: "expense" } });
  if (existing) return existing;
  const parent = await prisma.category.findFirst({ where: { name: "Empresa", type: "expense", parentId: null } });
  return prisma.category.create({
    data: { name: "Fornecedores", type: "expense", kind: "non_essential", parentId: parent?.id ?? null },
  });
}

async function getOrCreateTaxExpenseCategory() {
  const existing = await prisma.category.findFirst({ where: { name: "Imposto", type: "expense" } });
  if (existing) return existing;
  const fiscal = await prisma.category.findFirst({ where: { name: "Fiscal", type: "expense" } });
  return prisma.category.create({
    data: { name: "Imposto", type: "expense", kind: "non_essential", parentId: fiscal?.id ?? null },
  });
}

// ---------- Clientes ----------

projectsRouter.get("/clients", async (_req, res) => {
  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  res.json(clients);
});

projectsRouter.post("/clients", async (req, res) => {
  const { name, isForeign } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nome é obrigatório" });
  }
  const client = await prisma.client.create({ data: { name: name.trim(), isForeign: !!isForeign } });
  await getOrCreateClientIncomeCategory(client.name); // já deixa a categoria de receita pronta
  res.status(201).json(client);
});

projectsRouter.put("/clients/:id", async (req, res) => {
  const { name, isForeign } = req.body ?? {};
  const data: { name?: string; isForeign?: boolean } = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Nome não pode ser vazio" });
    data.name = name.trim();
  }
  if (isForeign !== undefined) data.isForeign = !!isForeign;
  const client = await prisma.client.update({ where: { id: req.params.id }, data });
  res.json(client);
});

// ---------- Fornecedores ----------

projectsRouter.get("/suppliers", async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  res.json(suppliers);
});

projectsRouter.post("/suppliers", async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nome é obrigatório" });
  }
  const supplier = await prisma.supplier.create({ data: { name: name.trim() } });
  res.status(201).json(supplier);
});

// ---------- Imposto (DAS) por projeto ----------
// Nacional: 6% fixo sobre o valor (quando tem NF), como sempre foi assumido.
// Estrangeiro: DAS é variável e só existe de verdade quando chega o boleto
// (TaxPayment) — o valor real daquele mês é rateado entre os projetos
// conforme a participação de cada um no faturamento do mês. Sem o boleto
// daquele mês, o imposto do projeto fica indeterminado (null = "a definir"),
// nunca um chute.
function computeProjectTax(
  project: { contractValue: number; hasInvoice: boolean },
  client: { isForeign: boolean },
  receipts: { amount: number; paymentDate: Date }[],
  taxPayments: { competenceMonth: number; competenceYear: number; totalRevenue: number; amountPaid: number }[]
): number | null {
  if (!project.hasInvoice) return 0;
  if (!client.isForeign) return project.contractValue * 0.06;

  const byMonth = new Map<string, number>();
  for (const r of receipts) {
    const key = `${r.paymentDate.getFullYear()}-${r.paymentDate.getMonth() + 1}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.amount);
  }
  if (byMonth.size === 0) return null;

  let total = 0;
  for (const [key, amountInMonth] of byMonth) {
    const [y, m] = key.split("-").map(Number);
    const tp = taxPayments.find((t) => t.competenceYear === y && t.competenceMonth === m);
    if (!tp || tp.totalRevenue <= 0) return null; // pelo menos um mês ainda sem DAS real — não dá pra fechar a conta
    total += (amountInMonth / tp.totalRevenue) * tp.amountPaid;
  }
  return total;
}

// ---------- Projetos ----------

projectsRouter.get("/projects", async (_req, res) => {
  const [projects, taxPayments] = await Promise.all([
    prisma.project.findMany({
      include: { client: true, receipts: true, supplierCosts: { include: { payments: true, supplier: true } } },
      orderBy: { startDate: "desc" },
    }),
    prisma.taxPayment.findMany(),
  ]);

  const result = projects.map((p) => {
    const received = p.receipts.reduce((s, r) => s + r.amount, 0);
    const remaining = Math.max(0, p.contractValue - received);
    const supplierCost = p.supplierCosts.reduce((s, c) => s + c.agreedAmount, 0);
    const supplierPaid = p.supplierCosts.reduce((s, c) => s + c.payments.reduce((ps, pay) => ps + pay.amount, 0), 0);
    const taxAmount = computeProjectTax(p, p.client, p.receipts, taxPayments);
    const net = taxAmount !== null ? p.contractValue - taxAmount - supplierCost : null;
    const daysTotal = p.endDate ? Math.round((p.endDate.getTime() - p.startDate.getTime()) / 86400000) : null;
    const yieldPerDay = net !== null && daysTotal ? net / daysTotal : null;
    const finalized = p.status !== "cancelado" && p.status !== "pausado" && received >= p.contractValue;
    const effectiveStatus = p.status === "cancelado" || p.status === "pausado" ? p.status : finalized ? "finalizado" : "em_andamento";

    return {
      id: p.id,
      client: { id: p.client.id, name: p.client.name, isForeign: p.client.isForeign },
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      contractValue: p.contractValue,
      hasInvoice: p.hasInvoice,
      installmentCount: p.installmentCount,
      status: effectiveStatus,
      daysTotal,
      received,
      remaining,
      supplierCost,
      supplierPaid,
      taxAmount,
      net,
      yieldPerDay,
      suppliers: p.supplierCosts.map((c) => ({
        id: c.id,
        supplierId: c.supplierId,
        supplierName: c.supplier.name,
        agreedAmount: c.agreedAmount,
        installmentCount: c.installmentCount,
        paid: c.payments.reduce((s, pay) => s + pay.amount, 0),
      })),
    };
  });

  res.json(result);
});

projectsRouter.get("/projects/:id", async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      client: true,
      receipts: { orderBy: { installmentNumber: "asc" } },
      supplierCosts: { include: { supplier: true, payments: { orderBy: { installmentNumber: "asc" } } } },
    },
  });
  if (!project) return res.status(404).json({ error: "Projeto não encontrado" });
  res.json(project);
});

projectsRouter.post("/projects", async (req, res) => {
  const { clientId, name, startDate, endDate, contractValue, hasInvoice, installmentCount } = req.body ?? {};
  if (!clientId || !name || !startDate || typeof contractValue !== "number") {
    return res.status(400).json({ error: "Campos obrigatórios: clientId, name, startDate, contractValue" });
  }
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente não encontrado" });

  const project = await prisma.project.create({
    data: {
      clientId,
      name,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      contractValue,
      hasInvoice: hasInvoice ?? true,
      installmentCount: installmentCount ?? 1,
    },
  });
  res.status(201).json(project);
});

projectsRouter.put("/projects/:id", async (req, res) => {
  const { name, startDate, endDate, contractValue, hasInvoice, installmentCount, status } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (startDate !== undefined) data.startDate = new Date(startDate);
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
  if (contractValue !== undefined) data.contractValue = contractValue;
  if (hasInvoice !== undefined) data.hasInvoice = hasInvoice;
  if (installmentCount !== undefined) data.installmentCount = installmentCount;
  if (status !== undefined) {
    if (!["em_andamento", "pausado", "cancelado"].includes(status)) {
      return res.status(400).json({ error: "status precisa ser em_andamento, pausado ou cancelado (finalizado é automático)" });
    }
    data.status = status;
  }
  const project = await prisma.project.update({ where: { id: req.params.id }, data });
  res.json(project);
});

// ---------- Recebimentos ----------

projectsRouter.post("/project-receipts", async (req, res) => {
  const { projectId, installmentNumber, amount, paymentDate } = req.body ?? {};
  if (!projectId || typeof amount !== "number" || !paymentDate) {
    return res.status(400).json({ error: "Campos obrigatórios: projectId, amount, paymentDate" });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { client: true } });
  if (!project) return res.status(404).json({ error: "Projeto não encontrado" });

  const category = await getOrCreateClientIncomeCategory(project.client.name);

  const receipt = await prisma.projectReceipt.create({
    data: { projectId, installmentNumber: installmentNumber ?? 1, amount, paymentDate: new Date(paymentDate) },
  });
  await prisma.transaction.create({
    data: {
      date: new Date(paymentDate),
      type: "income",
      description: `${project.client.name} — ${project.name} (parcela ${receipt.installmentNumber})`,
      amount,
      source: "manual",
      categoryId: category.id,
      projectReceiptId: receipt.id,
    },
  });
  res.status(201).json(receipt);
});

projectsRouter.delete("/project-receipts/:id", async (req, res) => {
  await prisma.transaction.deleteMany({ where: { projectReceiptId: req.params.id } });
  await prisma.projectReceipt.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
});

// ---------- Custo de fornecedor por projeto ----------

projectsRouter.post("/project-supplier-costs", async (req, res) => {
  const { projectId, supplierId, agreedAmount, installmentCount } = req.body ?? {};
  if (!projectId || !supplierId || typeof agreedAmount !== "number") {
    return res.status(400).json({ error: "Campos obrigatórios: projectId, supplierId, agreedAmount" });
  }
  const cost = await prisma.projectSupplierCost.create({
    data: { projectId, supplierId, agreedAmount, installmentCount: installmentCount ?? 1 },
  });
  res.status(201).json(cost);
});

// ---------- Pagamentos a fornecedor ----------

projectsRouter.post("/supplier-payments", async (req, res) => {
  const { projectSupplierCostId, installmentNumber, amount, paymentDate } = req.body ?? {};
  if (!projectSupplierCostId || typeof amount !== "number" || !paymentDate) {
    return res.status(400).json({ error: "Campos obrigatórios: projectSupplierCostId, amount, paymentDate" });
  }
  const cost = await prisma.projectSupplierCost.findUnique({
    where: { id: projectSupplierCostId },
    include: { supplier: true },
  });
  if (!cost) return res.status(404).json({ error: "Custo de fornecedor não encontrado" });

  const category = await getOrCreateSupplierExpenseCategory();
  const payment = await prisma.supplierPayment.create({
    data: { projectSupplierCostId, installmentNumber: installmentNumber ?? 1, amount, paymentDate: new Date(paymentDate) },
  });
  await prisma.transaction.create({
    data: {
      date: new Date(paymentDate),
      type: "expense",
      description: `${cost.supplier.name} (parcela ${payment.installmentNumber})`,
      amount,
      source: "manual",
      categoryId: category.id,
      supplierPaymentId: payment.id,
    },
  });
  res.status(201).json(payment);
});

// ---------- DAS (imposto real) ----------

// GET /api/tax-payments/preview?month&year — quanto faturou nesse mês de
// competência (soma de ProjectReceipt), pra ele saber que número usar no
// boleto antes de confirmar o pagamento.
projectsRouter.get("/tax-payments/preview", async (req, res) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!month || !year) return res.status(400).json({ error: "Query params obrigatórios: month, year" });
  const agg = await prisma.projectReceipt.aggregate({ where: { paymentDate: monthRange(year, month) }, _sum: { amount: true } });
  const existing = await prisma.taxPayment.findUnique({ where: { competenceMonth_competenceYear: { competenceMonth: month, competenceYear: year } } });
  res.json({ totalRevenue: agg._sum.amount ?? 0, alreadyExists: !!existing });
});

projectsRouter.get("/tax-payments", async (_req, res) => {
  const payments = await prisma.taxPayment.findMany({ orderBy: [{ competenceYear: "desc" }, { competenceMonth: "desc" }] });
  res.json(payments);
});

projectsRouter.post("/tax-payments", async (req, res) => {
  const { competenceMonth, competenceYear, totalRevenue, amountPaid, paymentDate } = req.body ?? {};
  if (!competenceMonth || !competenceYear || typeof amountPaid !== "number" || !paymentDate) {
    return res.status(400).json({ error: "Campos obrigatórios: competenceMonth, competenceYear, amountPaid, paymentDate" });
  }
  let revenue = totalRevenue;
  if (typeof revenue !== "number") {
    const agg = await prisma.projectReceipt.aggregate({
      where: { paymentDate: monthRange(competenceYear, competenceMonth) },
      _sum: { amount: true },
    });
    revenue = agg._sum.amount ?? 0;
  }

  const category = await getOrCreateTaxExpenseCategory();
  const tax = await prisma.taxPayment.upsert({
    where: { competenceMonth_competenceYear: { competenceMonth, competenceYear } },
    update: { totalRevenue: revenue, amountPaid, paymentDate: new Date(paymentDate) },
    create: { competenceMonth, competenceYear, totalRevenue: revenue, amountPaid, paymentDate: new Date(paymentDate) },
  });

  // Se já existia uma Transaction desse DAS (reenvio/correção), atualiza em
  // vez de duplicar.
  const existingTx = await prisma.transaction.findFirst({ where: { taxPaymentId: tax.id } });
  const description = `DAS — referente a ${String(competenceMonth).padStart(2, "0")}/${competenceYear}`;
  if (existingTx) {
    await prisma.transaction.update({
      where: { id: existingTx.id },
      data: { date: new Date(paymentDate), amount: amountPaid, description },
    });
  } else {
    await prisma.transaction.create({
      data: {
        date: new Date(paymentDate),
        type: "expense",
        description,
        amount: amountPaid,
        source: "manual",
        categoryId: category.id,
        taxPaymentId: tax.id,
      },
    });
  }

  res.status(201).json(tax);
});

// GET /api/projects-summary?year=2026
// Status financeiro dos projetos — tudo somado a partir de ProjectReceipt,
// TaxPayment, SupplierPayment e Project, sem número fixo.
projectsRouter.get("/projects-summary", async (req, res) => {
  const now = new Date();
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const lastMonthDate = new Date(year, month - 2, 1);

  const [receivedThisMonthAgg, receivedLastMonthAgg, receivedThisYearAgg, taxAgg, allReceipts, projects, allSupplierPayments, taxPayments] =
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
      prisma.project.findMany({ include: { client: true, receipts: true, supplierCosts: { include: { payments: true } } } }),
      prisma.supplierPayment.findMany(),
      prisma.taxPayment.findMany(),
    ]);

  // "Receita Bruta"/"Receita Líquida" — espelha a aba Visão Geral da
  // planilha: bruta é a soma do VALOR de todo projeto não cancelado (não é
  // "recebido", é o valor contratado inteiro), líquida desconta imposto
  // (quando conhecido — projeto de cliente estrangeiro sem DAS do mês ainda
  // não entra na conta, pra não inventar) e custo de fornecedor.
  const notCancelled = projects.filter((p) => p.status !== "cancelado");
  const grossRevenue = notCancelled.reduce((sum, p) => sum + p.contractValue, 0);
  let netRevenue = 0;
  let hasPendingTax = false;
  for (const p of notCancelled) {
    const supplierCost = p.supplierCosts.reduce((s, c) => s + c.agreedAmount, 0);
    const tax = computeProjectTax(p, p.client, p.receipts, taxPayments);
    if (tax === null) hasPendingTax = true;
    netRevenue += p.contractValue - (tax ?? 0) - supplierCost;
  }

  // "Ganhos totais por cliente" — mesma base da Receita Bruta (valor
  // contratado, não recebido), é o que a pizza da Visão Geral mostra.
  const clientContractMap = new Map<string, number>();
  for (const p of notCancelled) {
    clientContractMap.set(p.client.name, (clientContractMap.get(p.client.name) ?? 0) + p.contractValue);
  }
  const clientContractValue = [...clientContractMap.entries()].map(([label, value]) => ({ label, value }));

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
  const outstandingLastMonth = outstanding + receivedThisMonth;

  // fornecedor: pago vs a pagar (agreedAmount - pago), projetos não cancelados
  const supplierPaid = allSupplierPayments.reduce((s, p) => s + p.amount, 0);
  const supplierOutstanding = openProjects.reduce((sum, p) => {
    const agreed = p.supplierCosts.reduce((s, c) => s + c.agreedAmount, 0);
    const paid = p.supplierCosts.reduce((s, c) => s + c.payments.reduce((ps, pay) => ps + pay.amount, 0), 0);
    return sum + Math.max(0, agreed - paid);
  }, 0);

  // dias trabalhados / finalizados / em aberto — mesma regra do GET /projects
  let totalDays = 0;
  let finalizedCount = 0;
  let openCount = 0;
  for (const p of projects) {
    if (p.endDate) totalDays += Math.round((p.endDate.getTime() - p.startDate.getTime()) / 86400000);
    const received = p.receipts.reduce((s, r) => s + r.amount, 0);
    const finalized = p.status !== "cancelado" && p.status !== "pausado" && received >= p.contractValue;
    if (p.status === "cancelado") continue;
    if (finalized) finalizedCount++;
    else openCount++;
  }

  // receita por cliente no ano
  const clientRevenueMap = new Map<string, number>();
  for (const r of allReceipts) {
    if (r.paymentDate.getFullYear() !== year) continue;
    const name = r.project.client.name;
    clientRevenueMap.set(name, (clientRevenueMap.get(name) ?? 0) + r.amount);
  }
  const clientRevenue = [...clientRevenueMap.entries()].map(([label, value]) => ({ label, value }));

  // "ativo" de verdade: status manual em_andamento/pausado E ainda não
  // recebeu tudo — mesma regra derivada usada em finalizedCount/openCount
  // acima (senão um projeto 100% recebido continuava aparecendo "ativo" só
  // porque ninguém tinha ido lá marcar "finalizado" manualmente).
  const activeProjects = projects
    .filter((p) => {
      if (p.status === "cancelado") return false;
      const received = p.receipts.reduce((s, r) => s + r.amount, 0);
      return received < p.contractValue;
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      client: p.client.name,
      status: p.status,
      contractValue: p.contractValue,
      received: p.receipts.reduce((s, r) => s + r.amount, 0),
    }));

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
    grossRevenue,
    netRevenue,
    hasPendingTax,
    receivedThisMonth,
    receivedLastMonth: receivedLastMonthAgg._sum.amount ?? 0,
    receivedThisYear: receivedThisYearAgg._sum.amount ?? 0,
    avgMonthly12m,
    taxPaidThisYear: taxAgg._sum.amountPaid ?? 0,
    outstanding,
    outstandingLastMonth,
    supplierPaid,
    supplierOutstanding,
    totalDaysWorked: totalDays,
    finalizedCount,
    openCount,
    monthlyReceived,
    clientRevenue,
    clientContractValue,
    activeProjects,
    bestProjectThisMonth,
  });
});
