import { Router } from "express";
import { prisma } from "../prisma.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";
import { applyContribution, revertContribution } from "../services/contributions.js";

export const contributionsRouter = Router();

// GET /api/contributions/assets — lista pro seletor da modal "Registrar
// aporte": um item por (security, broker) ativo hoje, já com moeda/corretora
// pra não precisar redigitar. Mesma regra de "ativo hoje" do wealth-overview
// (activeSnapshotsAsOf) — não lista posição zerada/encerrada.
contributionsRouter.get("/contributions/assets", async (_req, res) => {
  const all = await fetchAllSnapshots();
  if (all.length === 0) return res.json([]);
  const nowYm = yearMonth(all[0].year, all[0].month);
  const active = activeSnapshotsAsOf(all, nowYm);
  const assets = active
    .map((s) => ({
      securityId: s.securityId,
      securityName: s.security.name,
      ticker: s.security.ticker,
      type: s.security.type,
      currency: s.security.currency,
      brokerId: s.brokerId,
      brokerName: s.broker.name,
      investedAmount: s.investedAmount,
    }))
    .sort((a, b) => a.brokerName.localeCompare(b.brokerName) || a.securityName.localeCompare(b.securityName));
  res.json(assets);
});

// GET /api/contributions?securityId=&brokerId= — histórico auditável.
contributionsRouter.get("/contributions", async (req, res) => {
  const { securityId, brokerId } = req.query;
  const contributions = await prisma.contribution.findMany({
    where: {
      securityId: typeof securityId === "string" ? securityId : undefined,
      brokerId: typeof brokerId === "string" ? brokerId : undefined,
    },
    include: { security: true, broker: true },
    orderBy: { date: "desc" },
  });
  res.json(
    contributions.map((c) => ({
      id: c.id,
      date: c.date,
      amount: c.amount,
      currency: c.currency,
      amountBRL: c.amountBRL,
      note: c.note,
      securityId: c.securityId,
      securityName: c.security.name,
      brokerId: c.brokerId,
      brokerName: c.broker.name,
    }))
  );
});

// POST /api/contributions — registra um aporte/resgate. Aceita um ativo
// existente (securityId+brokerId) OU a criação de ativo/corretora novos na
// hora (newSecurity/newBroker) — exatamente o fluxo pedido: "se for uma opção
// que não tenho cadastrado eu posso adicionar ela, a mesma coisa se for pra
// um banco que não tenho cadastrado".
contributionsRouter.post("/contributions", async (req, res) => {
  const { securityId, newSecurity, brokerId, newBroker, amount, currency, date, note } = req.body ?? {};

  if (typeof amount !== "number" || amount === 0) {
    return res.status(400).json({ error: "amount precisa ser um número diferente de zero (negativo pra resgate)." });
  }
  if (currency !== "BRL" && currency !== "USD") {
    return res.status(400).json({ error: 'currency precisa ser "BRL" ou "USD".' });
  }
  if (!securityId && !newSecurity) {
    return res.status(400).json({ error: "Informe securityId (ativo existente) ou newSecurity (ativo novo)." });
  }
  if (!brokerId && !newBroker) {
    return res.status(400).json({ error: "Informe brokerId (corretora existente) ou newBroker (corretora nova)." });
  }

  let resolvedBrokerId: string = brokerId;
  if (!brokerId) {
    if (!newBroker?.name) return res.status(400).json({ error: "newBroker.name é obrigatório." });
    const broker = await prisma.broker.create({
      data: {
        name: newBroker.name,
        scope: JSON.stringify(["investments"]),
        dataSource: "manual_statement",
        standalone: true, // corretora nova cadastrada por aqui é sempre manual — vira sua própria box em Patrimônio
      },
    });
    resolvedBrokerId = broker.id;
  } else {
    const broker = await prisma.broker.findUnique({ where: { id: brokerId } });
    if (!broker) return res.status(404).json({ error: "Corretora não encontrada." });
  }

  let resolvedSecurityId: string = securityId;
  if (!securityId) {
    if (!newSecurity?.name || !newSecurity?.type) {
      return res.status(400).json({ error: "newSecurity.name e newSecurity.type são obrigatórios." });
    }
    const broker = await prisma.broker.findUniqueOrThrow({ where: { id: resolvedBrokerId } });
    const id = `MANUAL:${broker.name}:${newSecurity.name}`.toUpperCase();
    const security = await prisma.security.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: newSecurity.name,
        ticker: newSecurity.ticker ?? null,
        type: newSecurity.type,
        currency: newSecurity.currency === "USD" ? "USD" : "BRL",
      },
    });
    resolvedSecurityId = security.id;
  } else {
    const security = await prisma.security.findUnique({ where: { id: securityId } });
    if (!security) return res.status(404).json({ error: "Ativo não encontrado." });
  }

  try {
    const contribution = await applyContribution({
      brokerId: resolvedBrokerId,
      securityId: resolvedSecurityId,
      date: date ? new Date(date) : new Date(),
      amount,
      currency,
      note: note ?? null,
    });
    res.status(201).json(contribution);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// DELETE /api/contributions/:id — desfaz um lançamento errado (reverte o
// delta nos snapshots afetados e apaga o registro). Não existe "editar":
// apaga e lança de novo.
contributionsRouter.delete("/contributions/:id", async (req, res) => {
  try {
    await revertContribution(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});
