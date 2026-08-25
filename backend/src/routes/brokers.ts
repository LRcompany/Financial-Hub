import { Router } from "express";
import { prisma } from "../prisma.js";
import { syncBrokerInvestments } from "../services/pluggySync.js";
import { syncOnchainWallet } from "../services/onchainSync.js";

export const brokersRouter = Router();

brokersRouter.get("/brokers", async (_req, res) => {
  const brokers = await prisma.broker.findMany({ orderBy: { name: "asc" } });
  res.json(brokers);
});

// POST /api/brokers/:id/sync — sincroniza de acordo com o dataSource do broker:
// "pluggy" puxa da Pluggy (pluggyConnectorId = itemId da conexão), "onchain_query"
// consulta a blockchain direto (onchainAddress = endereço público da carteira).
brokersRouter.post("/brokers/:id/sync", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });

  if (broker.dataSource === "pluggy" && broker.pluggyConnectorId) {
    try {
      const result = await syncBrokerInvestments(broker.id, broker.pluggyConnectorId);
      return res.json({ synced: true, ...result });
    } catch (err) {
      return res.status(502).json({ error: `Falha ao sincronizar com a Pluggy: ${(err as Error).message}` });
    }
  }

  if (broker.dataSource === "onchain_query" && broker.onchainAddress) {
    try {
      const result = await syncOnchainWallet(broker.id);
      return res.json({ synced: true, ...result });
    } catch (err) {
      return res.status(502).json({ error: `Falha ao consultar a blockchain: ${(err as Error).message}` });
    }
  }

  res.status(400).json({ error: "Esse broker não está configurado para nenhum sync automático" });
});
