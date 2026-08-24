import { Router } from "express";
import { prisma } from "../prisma.js";
import { getUsdToBrlRate } from "../services/fx.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";

export const positionsRouter = Router();

const SECURITY_TYPES = ["FII", "Ação", "Renda Fixa", "Cripto", "Moeda", "Fundo", "Outro"];

// GET /api/positions — posições ainda ativas hoje, agrupadas por tipo
// (Ações/FIIs/Renda Fixa/etc). Usa a mesma regra de "ativo" de wealth.ts —
// ver services/activePositions.ts (corretora encerrada some da lista, e um
// broker que migrou de planilha manual pra Pluggy não conta a mesma posição
// duas vezes).
positionsRouter.get("/positions", async (_req, res) => {
  const all = await fetchAllSnapshots();

  if (all.length === 0) {
    return res.json({ hasData: false, byType: [] });
  }

  const nowYm = yearMonth(all[0].year, all[0].month);
  const latest = activeSnapshotsAsOf(all, nowYm);

  const byType = new Map<string, { broker: string; name: string; ticker: string | null; investedAmount: number; marketValue: number; currency: string; month: number; year: number }[]>();
  for (const s of latest) {
    // ativo zerado (CDB vencido, lote resgatado) — a Pluggy continua devolvendo
    // a posição histórica com saldo 0, não é uma posição de verdade pra listar
    if (s.marketValue <= 0 && s.investedAmount <= 0) continue;
    const list = byType.get(s.security.type) ?? [];
    list.push({
      broker: s.broker.name,
      name: s.security.name,
      ticker: s.security.ticker,
      investedAmount: s.investedAmount,
      marketValue: s.marketValue,
      currency: s.security.currency,
      month: s.month,
      year: s.year,
    });
    byType.set(s.security.type, list);
  }

  const result = [...byType.entries()]
    .map(([type, positions]) => ({
      type,
      total: positions.reduce((sum, p) => sum + p.marketValue, 0),
      positions: positions.sort((a, b) => b.marketValue - a.marketValue),
    }))
    .sort((a, b) => b.total - a.total);

  res.json({ hasData: all.length > 0, byType: result });
});

// POST /api/positions — lançamento manual, só faz sentido pra corretora sem
// sync automático (Nomad, Wise, Phantom...). Cria o Broker/Security na hora
// se ainda não existirem. Valores em USD são convertidos pra BRL na hora de
// gravar (mesma regra do sync da Pluggy) — investedAmount/marketValue no
// banco são sempre BRL, nunca mistura escala na soma do patrimônio.
positionsRouter.post("/positions", async (req, res) => {
  const { brokerName, securityName, type, currency, investedAmount, marketValue, ticker } = req.body ?? {};
  if (!brokerName || !securityName || !type || typeof investedAmount !== "number" || typeof marketValue !== "number") {
    return res.status(400).json({ error: "Campos obrigatórios: brokerName, securityName, type, investedAmount, marketValue" });
  }
  if (!SECURITY_TYPES.includes(type)) {
    return res.status(400).json({ error: `type precisa ser um de: ${SECURITY_TYPES.join(", ")}` });
  }

  const assetCurrency = currency === "USD" ? "USD" : "BRL";
  let fxRateToBRL: number | null = null;
  let investedAmountBRL = investedAmount;
  let marketValueBRL = marketValue;
  if (assetCurrency === "USD") {
    try {
      fxRateToBRL = await getUsdToBrlRate();
    } catch (err) {
      return res.status(502).json({ error: `Falha ao buscar cotação USD/BRL: ${(err as Error).message}` });
    }
    investedAmountBRL = investedAmount * fxRateToBRL;
    marketValueBRL = marketValue * fxRateToBRL;
  }

  const broker = await prisma.broker.upsert({
    where: { name: brokerName },
    update: {},
    create: { name: brokerName, dataSource: "manual_statement", scope: JSON.stringify(["investments"]) },
  });

  const securityKey = `manual:${brokerName}:${securityName}`.toUpperCase();
  const security = await prisma.security.upsert({
    where: { id: securityKey },
    update: { name: securityName, ticker: ticker ?? null, type, currency: assetCurrency },
    create: { id: securityKey, name: securityName, ticker: ticker ?? null, type, currency: assetCurrency },
  });

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const snapshot = await prisma.positionSnapshot.upsert({
    where: { brokerId_securityId_month_year: { brokerId: broker.id, securityId: security.id, month, year } },
    update: { investedAmount: investedAmountBRL, marketValue: marketValueBRL, fxRateToBRL },
    create: { brokerId: broker.id, securityId: security.id, month, year, investedAmount: investedAmountBRL, marketValue: marketValueBRL, fxRateToBRL },
  });

  res.status(201).json(snapshot);
});
