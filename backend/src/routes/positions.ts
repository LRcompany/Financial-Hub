import { Router } from "express";
import { prisma } from "../prisma.js";
import { getUsdToBrlRate } from "../services/fx.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";

export const positionsRouter = Router();

const SECURITY_TYPES = ["FII", "Ação", "Renda Fixa", "Cripto", "Moeda", "Fundo", "Outro"];

// GET /api/fx-rate — cotação USD/BRL atual, pra exibição (converter um total
// já em BRL de volta pra USD na tela, ex: total de Cripto). Diferente do
// fxRateToBRL gravado por posição (esse é a taxa histórica de quando aquela
// posição específica foi registrada — mais precisa pra ela, não serve pra
// posição que nunca teve uma taxa própria gravada, tipo Cripto).
positionsRouter.get("/fx-rate", async (_req, res) => {
  try {
    const usdToBrl = await getUsdToBrlRate();
    res.json({ usdToBrl });
  } catch (err) {
    res.status(502).json({ error: `Falha ao buscar cotação USD/BRL: ${(err as Error).message}` });
  }
});

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

  const byType = new Map<
    string,
    {
      broker: string;
      name: string;
      ticker: string | null;
      investedAmount: number;
      marketValue: number;
      currency: string;
      fxRateToBRL: number | null;
      month: number;
      year: number;
      quantity: number | null;
      unitValue: number | null;
      isin: string | null;
      issuer: string | null;
      dueDate: string | null;
      fixedAnnualRate: number | null;
      ratePeriodicity: string | null;
    }[]
  >();
  for (const s of latest) {
    // ativo zerado (CDB vencido, lote resgatado) — a Pluggy continua devolvendo
    // a posição histórica com saldo 0, não é uma posição de verdade pra listar
    if (s.marketValue <= 0 && s.investedAmount <= 0) continue;
    // Corretora "standalone" (Nomad) vira sua própria box em vez de espalhar
    // por tipo — bond e ETF são a mesma carteira, não Renda Fixa + Fundo.
    const groupKey = s.broker.standalone ? s.broker.name : s.security.type;
    const list = byType.get(groupKey) ?? [];
    list.push({
      broker: s.broker.name,
      name: s.security.name,
      ticker: s.security.ticker,
      investedAmount: s.investedAmount,
      marketValue: s.marketValue,
      currency: s.security.currency,
      fxRateToBRL: s.fxRateToBRL,
      month: s.month,
      year: s.year,
      quantity: s.quantity,
      unitValue: s.unitValue,
      isin: s.security.isin,
      issuer: s.security.issuer,
      dueDate: s.security.dueDate ? s.security.dueDate.toISOString() : null,
      fixedAnnualRate: s.security.fixedAnnualRate,
      ratePeriodicity: s.security.ratePeriodicity,
    });
    byType.set(groupKey, list);
  }

  const standaloneBrokerNames = new Set(
    (await prisma.broker.findMany({ where: { standalone: true }, select: { name: true } })).map((b) => b.name)
  );

  const result = [...byType.entries()]
    .map(([key, positions]) => ({
      type: key,
      isBroker: standaloneBrokerNames.has(key),
      total: positions.reduce((sum, p) => sum + p.marketValue, 0),
      positions: positions.sort((a, b) => b.marketValue - a.marketValue),
    }))
    .sort((a, b) => b.total - a.total);

  res.json({ hasData: all.length > 0, byType: result });
});

// GET /api/positions/history?broker=Nomad — evolução mensal do valor total
// numa corretora específica (últimos 24 meses com dado). Serve pro gráfico
// de "como isso variou ao longo do tempo" quando a posição é de uma corretora
// só (Nomad, Phantom, o fundo da BTG) — comparar por ativo/corretora não faz
// sentido nesses casos, mas ver a evolução no tempo sim.
positionsRouter.get("/positions/history", async (req, res) => {
  const brokerName = (req.query.broker as string | undefined)?.trim();
  if (!brokerName) return res.status(400).json({ error: "query param 'broker' obrigatório" });

  const all = await fetchAllSnapshots();
  const brokerSnaps = all.filter((s) => s.broker.name.toLowerCase() === brokerName.toLowerCase());
  if (brokerSnaps.length === 0) return res.json({ history: [] });

  const nowYm = yearMonth(brokerSnaps[0].year, brokerSnaps[0].month);
  const history: { label: string; value: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const ym = nowYm - i;
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    const snaps = activeSnapshotsAsOf(brokerSnaps, ym);
    if (snaps.length === 0) continue;
    history.push({
      label: new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      value: snaps.reduce((sum, s) => sum + s.marketValue, 0),
    });
  }
  res.json({ history });
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
