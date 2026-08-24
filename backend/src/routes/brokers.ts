import { Router } from "express";
import { prisma } from "../prisma.js";
import { syncBrokerInvestments } from "../services/pluggySync.js";

export const brokersRouter = Router();

brokersRouter.get("/brokers", async (_req, res) => {
  const brokers = await prisma.broker.findMany({ orderBy: { name: "asc" } });
  res.json(brokers);
});

// POST /api/brokers/:id/sync — puxa investimentos reais da Pluggy pro broker.
// Só funciona pra brokers com dataSource "pluggy" e um itemId salvo (pluggyConnectorId
// guarda aqui o itemId da conexão, não o connector genérico — nome herdado do blueprint).
brokersRouter.post("/brokers/:id/sync", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  if (broker.dataSource !== "pluggy" || !broker.pluggyConnectorId) {
    return res.status(400).json({ error: "Esse broker não está configurado para sync via Pluggy" });
  }

  try {
    const result = await syncBrokerInvestments(broker.id, broker.pluggyConnectorId);
    res.json({ synced: true, ...result });
  } catch (err) {
    res.status(502).json({ error: `Falha ao sincronizar com a Pluggy: ${(err as Error).message}` });
  }
});
