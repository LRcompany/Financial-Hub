import { Router } from "express";
import { prisma } from "../prisma.js";
import { getUsdToBrlRate } from "../services/fx.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";

export const positionsRouter = Router();

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

  // Mês anterior por (broker, security) — só usado pra "Conta Corrente" (ver
  // Patrimonio.tsx), que mostra variação de saldo em vez de rentabilidade
  // (pedido do Luiz, 08/09: "não existe cotas, preço, investido... registra
  // isso pela variação"). Calculado pra tudo (é barato, uma segunda passada
  // já em memória) em vez de só pro tipo certo, pra não duplicar a regra de
  // "qual snapshot conta" (`activeSnapshotsAsOf`) fora daqui.
  const previousByKey = new Map<string, number>();
  for (const s of activeSnapshotsAsOf(all, nowYm - 1)) {
    previousByKey.set(`${s.brokerId}:${s.securityId}`, s.marketValue);
  }

  // Provento por (broker, security) do mês EXATO — mês atual e anterior (11/09,
  // seta tipo MonthDelta na coluna "Proventos"). Vem de `DividendPayment`
  // (não de `PositionSnapshot.dividends`) pelo mesmo motivo de `wealth.ts`:
  // dividendo é um FLUXO ligado à data real da transação, não ao mês em que
  // por acaso já existe snapshot daquela posição — `activeSnapshotsAsOf`
  // arrastaria pra frente o provento de um mês antigo e mostraria como se
  // fosse do mês atual. Só entra no map quando aquele mês exato TEM
  // pagamento registrado — vira `undefined` no lookup senão, e o front sabe
  // que não tem dado real daquele mês (não mostra R$0 ou seta fingindo).
  async function dividendsByExactMonth(ym: number): Promise<Map<string, number>> {
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    const payments = await prisma.dividendPayment.findMany({ where: { year, month } });
    const map = new Map<string, number>();
    for (const p of payments) {
      map.set(`${p.brokerId}:${p.securityId}`, p.amount);
    }
    return map;
  }
  const currentDividendsByKey = await dividendsByExactMonth(nowYm);
  const previousDividendsByKey = await dividendsByExactMonth(nowYm - 1);

  const byType = new Map<
    string,
    {
      broker: string;
      name: string;
      ticker: string | null;
      investedAmount: number;
      marketValue: number;
      previousMarketValue: number | null;
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
      dividends: number | null;
      previousDividends: number | null;
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
      previousMarketValue: previousByKey.get(`${s.brokerId}:${s.securityId}`) ?? null,
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
      // Proventos do mês EXATO (11/09) — só Ação/FII têm valor real (ver
      // pluggySync.ts); vem de `currentDividendsByKey`, não de `s.dividends`
      // direto, pelo mesmo motivo do comentário acima (flow, não estado
      // arrastável). null = "não se aplica" pra esse tipo de ativo, "ainda
      // não sincronizado esse mês", ou corretora sem provento esse mês —
      // nunca 0 fake.
      dividends: currentDividendsByKey.get(`${s.brokerId}:${s.securityId}`) ?? null,
      previousDividends: previousDividendsByKey.get(`${s.brokerId}:${s.securityId}`) ?? null,
    });
    byType.set(groupKey, list);
  }

  const standaloneBrokerNames = new Set(
    (await prisma.broker.findMany({ where: { standalone: true, archivedAt: null }, select: { name: true } })).map((b) => b.name)
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

// GET /api/positions/history?group=Ação — evolução mensal do valor total de
// um GRUPO (últimos 24 meses com dado), no mesmo agrupamento do /positions
// (broker.standalone vira o próprio nome, senão é security.type). Por
// corretora sozinha (regra antiga) misturava tipos — a caixa "Ação" mostrava
// o BTG inteiro (Renda Fixa+FII+Ação+Fundo somados), não só as ações; agora
// filtra igual ao agrupamento que a tela realmente mostra.
positionsRouter.get("/positions/history", async (req, res) => {
  const group = (req.query.group as string | undefined)?.trim();
  if (!group) return res.status(400).json({ error: "query param 'group' obrigatório" });

  const all = await fetchAllSnapshots();
  const groupSnaps = all.filter((s) => (s.broker.standalone ? s.broker.name : s.security.type).toLowerCase() === group.toLowerCase());
  if (groupSnaps.length === 0) return res.json({ history: [] });

  const nowYm = yearMonth(groupSnaps[0].year, groupSnaps[0].month);
  const history: { label: string; value: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const ym = nowYm - i;
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    const snaps = activeSnapshotsAsOf(groupSnaps, ym);
    if (snaps.length === 0) continue;
    history.push({
      label: new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      value: snaps.reduce((sum, s) => sum + s.marketValue, 0),
    });
  }
  res.json({ history });
});

