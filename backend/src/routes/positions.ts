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

  // Provento ACUMULADO desde sempre por (broker, security) — pedido do
  // Luiz (11/09): "quanto eu recebi de um ativo desde o início até agora?".
  // Soma TODO `DividendPayment` daquela posição, sem filtro de mês/ano —
  // diferente do mês exato acima, aqui é histórico completo. `groupBy` faz
  // a soma no banco em vez de trazer toda linha pra somar em memória.
  const totalDividendsByKey = new Map<string, number>();
  for (const d of await prisma.dividendPayment.groupBy({ by: ["brokerId", "securityId"], _sum: { amount: true } })) {
    totalDividendsByKey.set(`${d.brokerId}:${d.securityId}`, d._sum.amount ?? 0);
  }

  const byType = new Map<
    string,
    {
      brokerId: string;
      securityId: string;
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
      totalDividends: number | null;
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
      // brokerId/securityId (11/09) — pro front conseguir identificar a
      // posição exata ao lançar um provento manual (botão "+ Rendimento",
      // hoje só pra Fundo — a Pluggy não manda transação de dividendo pra
      // esse tipo). Antes só tinha o NOME da corretora (`broker`), que não
      // serve pra endereçar um registro no banco.
      brokerId: s.brokerId,
      securityId: s.securityId,
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
      // Acumulado desde sempre (11/09, "quanto eu recebi desse ativo desde
      // o início até agora?") — null = nunca teve provento coletado/lançado,
      // nunca 0 fake pra ativo que não paga.
      totalDividends: totalDividendsByKey.get(`${s.brokerId}:${s.securityId}`) ?? null,
    });
    byType.set(groupKey, list);
  }

  // Consolida lotes da MESMA posição (11/09, pedido do Luiz: "por que
  // Tesouro Direto - LFT aparece várias vezes se é um item só?"). A Pluggy
  // trata cada COMPRA de Renda Fixa como um Investment separado (confirmado
  // ao vivo: mesmo ISIN, `id` diferente por lote) — comprar o mesmo título
  // em datas diferentes virava uma linha nova na tabela a cada vez, mesmo
  // sendo economicamente o mesmo ativo. Agrupa por corretora+ISIN (ou nome,
  // quando o ativo não tem ISIN — caso de crowdfunding/CCB sem título
  // público) e soma quantidade/investido/valor atual. Nunca agrupa só por
  // NOME sozinho quando existe ISIN: dois títulos diferentes podem ter o
  // mesmo nome comercial ("TESOURO DIRETO - LFT") com vencimento diferente
  // — o ISIN é o que garante que só lotes do MESMO papel se juntam.
  for (const [groupKey, positions] of byType) {
    const merged = new Map<string, (typeof positions)[number]>();
    for (const p of positions) {
      const lotKey = `${p.brokerId}:${p.isin ?? `nome:${p.name}`}`;
      const existing = merged.get(lotKey);
      if (!existing) {
        merged.set(lotKey, { ...p });
        continue;
      }
      existing.investedAmount += p.investedAmount;
      existing.marketValue += p.marketValue;
      if (existing.previousMarketValue != null || p.previousMarketValue != null) {
        existing.previousMarketValue = (existing.previousMarketValue ?? 0) + (p.previousMarketValue ?? 0);
      }
      existing.quantity = existing.quantity != null && p.quantity != null ? existing.quantity + p.quantity : null;
      if (existing.dividends != null || p.dividends != null) {
        existing.dividends = (existing.dividends ?? 0) + (p.dividends ?? 0);
      }
      if (existing.previousDividends != null || p.previousDividends != null) {
        existing.previousDividends = (existing.previousDividends ?? 0) + (p.previousDividends ?? 0);
      }
      if (existing.totalDividends != null || p.totalDividends != null) {
        existing.totalDividends = (existing.totalDividends ?? 0) + (p.totalDividends ?? 0);
      }
    }
    // Preço unitário recalculado sobre a quantidade TOTAL consolidada — o
    // valor de um lote sozinho não representa mais a posição inteira.
    for (const p of merged.values()) {
      if (p.quantity != null && p.quantity > 0) p.unitValue = p.marketValue / p.quantity;
    }
    byType.set(groupKey, [...merged.values()]);
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

// ---- Lançamento manual de provento (11/09) — pedido do Luiz pro fundo
// VALORA: a Pluggy não manda transação de dividendo pra tipo "Fundo" (só
// Ação/FII, ver pluggySync.ts), mas ele quer acompanhar o rendimento mensal
// mesmo assim, "pra saber a valorização do fundo de forma clara". Grava
// direto em `DividendPayment` — a MESMA tabela que a sincronização da
// Pluggy usa pra Ação/FII, então esse provento manual automaticamente entra
// no card/gráfico agregado "Proventos recebidos" e na coluna "Proventos
// (mês)" da posição, sem precisar de nenhum código separado pra exibição.

// GET /api/dividend-payments?brokerId=X&securityId=Y — histórico de
// lançamentos de uma posição, mais recente primeiro (alimenta a lista da
// modal "Rendimentos" antes de adicionar um novo).
positionsRouter.get("/dividend-payments", async (req, res) => {
  const brokerId = req.query.brokerId as string | undefined;
  const securityId = req.query.securityId as string | undefined;
  if (!brokerId || !securityId) return res.status(400).json({ error: "brokerId e securityId são obrigatórios" });

  const payments = await prisma.dividendPayment.findMany({
    where: { brokerId, securityId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  res.json({ payments });
});

// POST /api/dividend-payments — cria/corrige o provento de UM mês (a data
// enviada só serve pra saber a QUE mês aquele valor pertence — a Pluggy
// também trabalha em granularidade de mês, nunca por dia). Enviar de novo
// pro mesmo mês SUBSTITUI o valor anterior (não soma) — é assim que o Luiz
// corrige um lançamento errado, sem precisar apagar e recriar.
positionsRouter.post("/dividend-payments", async (req, res) => {
  const { brokerId, securityId, date, amount } = req.body as { brokerId?: string; securityId?: string; date?: string; amount?: number };
  if (!brokerId || !securityId || !date || amount == null) {
    return res.status(400).json({ error: "brokerId, securityId, date e amount são obrigatórios" });
  }
  if (amount <= 0) return res.status(400).json({ error: "amount precisa ser maior que zero" });

  const [year, month] = date.split("-").map(Number); // "2026-03-15" -> [2026, 3], sem passar por Date/UTC
  if (!year || !month) return res.status(400).json({ error: "date inválida" });

  const payment = await prisma.dividendPayment.upsert({
    where: { brokerId_securityId_month_year: { brokerId, securityId, month, year } },
    update: { amount },
    create: { brokerId, securityId, month, year, amount },
  });
  res.json({ payment });
});

// DELETE /api/dividend-payments/:id — remove um lançamento manual (ex:
// adicionado no mês errado por engano).
positionsRouter.delete("/dividend-payments/:id", async (req, res) => {
  await prisma.dividendPayment.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ deleted: true });
});

