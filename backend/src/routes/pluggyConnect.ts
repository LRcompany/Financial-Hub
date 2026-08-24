import { Router } from "express";
import { prisma } from "../prisma.js";
import { createConnectToken } from "../services/pluggy.js";

export const pluggyConnectRouter = Router();

// POST /api/pluggy/connect-token — body opcional { itemId } pra reautenticar uma conexão existente.
// O frontend usa o accessToken retornado pra abrir o widget oficial da Pluggy (login bancário
// acontece só dentro do widget deles — nunca passa pelo nosso backend).
pluggyConnectRouter.post("/pluggy/connect-token", async (req, res) => {
  try {
    const { itemId } = req.body ?? {};
    const token = await createConnectToken(itemId);
    res.json(token);
  } catch (err) {
    res.status(502).json({ error: `Falha ao criar connect token: ${(err as Error).message}` });
  }
});

// POST /api/pluggy/link-broker — chamado pelo frontend no onSuccess do widget,
// com o itemId e o nome do banco que vieram de dentro do widget.
// Cria o Broker se for a primeira vez, ou atualiza o itemId se já existir (reconexão).
pluggyConnectRouter.post("/pluggy/link-broker", async (req, res) => {
  const { itemId, connectorName } = req.body ?? {};
  if (!itemId || !connectorName) {
    return res.status(400).json({ error: "Campos obrigatórios: itemId, connectorName" });
  }

  const broker = await prisma.broker.upsert({
    where: { name: connectorName },
    update: { pluggyConnectorId: itemId, dataSource: "pluggy" },
    create: {
      name: connectorName,
      dataSource: "pluggy",
      pluggyConnectorId: itemId,
      scope: JSON.stringify(["transactions", "investments"]),
    },
  });

  res.status(201).json(broker);
});
