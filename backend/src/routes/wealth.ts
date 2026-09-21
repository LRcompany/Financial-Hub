import { Router } from "express";
import { prisma } from "../prisma.js";
import { computeAverageMonthlyReturnPct, projectFirstMillion } from "../services/wealthProjection.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, automatedStartYmByBrokerType, yearMonth } from "../services/activePositions.js";

export const wealthRouter = Router();

// GET /api/wealth-overview
// Tudo calculado em cima de PositionSnapshot (populado pelo sync da Pluggy ou
// lançamento manual) — sem número fixo. Enquanto não houver snapshot nenhum,
// retorna hasData: false em vez de zero fake.
// `month`/`year` opcionais (08/09, relatório mensal) — sem eles, comportamento
// de sempre ("agora", usado por Dashboard/Patrimônio). Com eles, todo o
// resto da conta (`total`, `previousTotal`, `movers`, `investedThisMonth`...)
// desliza pra ver a carteira COMO ELA ESTAVA naquele mês, não hoje — sem
// isso, o relatório de um mês passado mostraria o patrimônio de hoje, errado.
wealthRouter.get("/wealth-overview", async (req, res) => {
  const all = await fetchAllSnapshots();

  if (all.length === 0) {
    const wealthGoal = await prisma.wealthGoal.findFirst();
    return res.json({
      hasData: false,
      wealthGoal,
      evolution: [],
      investedByMonth: [],
      dividendsByMonth: [],
      allocation: [],
      movers: [],
      avgMonthlyReturnPct: null,
      projection: null,
      yearlyBreakdown: [],
    });
  }

  const queryMonth = req.query.month ? Number(req.query.month) : null;
  const queryYear = req.query.year ? Number(req.query.year) : null;
  const nowYm = queryMonth && queryYear ? yearMonth(queryYear, queryMonth) : yearMonth(all[0].year, all[0].month);
  const latestSnaps = activeSnapshotsAsOf(all, nowYm);
  const previousSnaps = activeSnapshotsAsOf(all, nowYm - 1);
  const beforePreviousSnaps = activeSnapshotsAsOf(all, nowYm - 2);

  const total = latestSnaps.reduce((sum, s) => sum + s.marketValue, 0);
  const previousTotal = previousSnaps.reduce((sum, s) => sum + s.marketValue, 0);

  // ---- alocação por tipo de ativo (posições ativas hoje) ----
  // Mesma regra de agrupamento do /api/positions (broker "standalone" vira
  // sua própria fatia, não espalha por tipo) — os dois endpoints têm que
  // bater exatamente, senão Dashboard e Patrimônio mostram número diferente
  // pro mesmo dado (era o caso da Nomad: aqui contava Renda Fixa/Fundo/Moeda
  // separado, lá contava tudo junto como "NOMAD").
  const allocationMap = new Map<string, number>();
  for (const s of latestSnaps) {
    const key = s.broker.standalone ? s.broker.name : s.security.type;
    allocationMap.set(key, (allocationMap.get(key) ?? 0) + s.marketValue);
  }
  const allocation = [...allocationMap.entries()].map(([label, value]) => ({ label, value }));

  // ---- evolução: últimos 12 meses corridos, carregando o último valor ativo de cada mês ----
  // Guarda o investedAmount total junto (não só marketValue) — é o que
  // permite calcular o retorno médio REAL da carteira mais abaixo (separar
  // valorização de mercado de dinheiro novo que entrou).
  const evolution: { label: string; value: number }[] = [];
  const monthlyTotals: { marketValue: number; investedAmount: number }[] = [];
  // Ano-calendário E ym de cada entrada de `evolution`/`monthlyTotals`, na
  // mesma ordem/índice (o loop pula mês sem snapshot, então não dá pra
  // recalcular isso de fora depois — precisa guardar junto). `monthMetaYear`
  // usado logo abaixo pra somar só os meses do ano corrente (aportado real
  // no ano); `monthYms` usado pra achar mês de migração manual→automático
  // (ver `investedByKey`/`automatedStartYm` abaixo).
  const monthMetaYear: number[] = [];
  const monthYms: number[] = [];
  // Soma de investedAmount por chave `brokerId:security.type`, um mês por
  // índice (mesmo índice de `evolution`/`monthlyTotals`) — permite achar,
  // mês a mês, quanto cada broker+tipo tinha investido, pra excluir da conta
  // de "aporte" o mês exato em que um broker+tipo migra de manual pra
  // automático (ver mais abaixo).
  function investedByKey(snaps: typeof all) {
    const map = new Map<string, number>();
    for (const s of snaps) {
      const key = `${s.brokerId}:${s.security.type}`;
      map.set(key, (map.get(key) ?? 0) + s.investedAmount);
    }
    return map;
  }
  const investedByKeyByMonth: Map<string, number>[] = [];
  for (let i = 11; i >= 0; i--) {
    const ym = nowYm - i;
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    const snaps = activeSnapshotsAsOf(all, ym);
    if (snaps.length === 0) continue; // nada existia ainda nesse mês, não polui o gráfico com zero fake
    evolution.push({
      label: new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      value: snaps.reduce((sum, s) => sum + s.marketValue, 0),
    });
    monthlyTotals.push({
      marketValue: snaps.reduce((sum, s) => sum + s.marketValue, 0),
      investedAmount: snaps.reduce((sum, s) => sum + s.investedAmount, 0),
    });
    monthMetaYear.push(year);
    monthYms.push(ym);
    investedByKeyByMonth.push(investedByKey(snaps));
  }
  const avgMonthlyReturnPct = computeAverageMonthlyReturnPct(monthlyTotals);

  // ---- investido por mês (histórico) — pro gráfico "Investido por mês" E
  // pro "Aportado real" da "Primeiro Milhão" ----
  // Mesma ideia de `investedDelta` abaixo, mas mês a mês pra todo o período
  // visível (não só o mês atual x anterior). Precisa de 1 mês a mais de
  // baseline (nowYm-12) só pra conseguir calcular a variação do PRIMEIRO mês
  // visível também — senão o gráfico começaria faltando o primeiro ponto.
  const baselineSnaps = activeSnapshotsAsOf(all, nowYm - 12);
  const baselineInvestedByKey = baselineSnaps.length > 0 ? investedByKey(baselineSnaps) : null;
  // Bug real (14/09, Luiz: "o valor que mostra em aportado real, realmente
  // está correto?"): quando um broker+tipo migra de manual pra automático
  // (Pluggy — ver `activeSnapshotsAsOf`), o `investedAmount` daquele tipo
  // muda de fonte no MESMO mês — de "o que o Luiz digitou à mão" pra "o que
  // a Pluggy calcula de verdade". Comparar esse mês com o anterior como se
  // fosse um aporte normal conta a DIFERENÇA DE PRECISÃO entre as duas
  // fontes como se fosse dinheiro novo — achado real: a migração da Sofisa
  // em ago/2026 sozinha "criou" R$36 mil de "aporte" que não existiu (manual
  // tinha só R$18.000 registrado, a Pluggy revelou R$54.040 de verdade — a
  // diferença é o manual tendo subestimado o valor o tempo todo, não dinheiro
  // que entrou naquele mês). Fix: no mês EXATO em que um broker+tipo começa a
  // ter fonte automática (`automatedStartYm === ym` daquele mês), a
  // contribuição desse broker+tipo pro delta do mês é ZERADA (nem soma nem
  // subtrai) — os outros broker+tipo do mesmo mês continuam contando normal.
  const automatedStartYm = automatedStartYmByBrokerType(all);
  // Guarda o ano-calendário junto de cada delta — sem baseline (12 meses
  // atrás sem snapshot nenhum), o primeiro mês de `monthlyTotals` fica de
  // fora do `investedByMonth` (não dá pra calcular delta sem "antes"), então
  // os índices dos dois arrays NÃO alinham 1:1 nesse caso — não dá pra
  // recuperar o ano depois só pelo índice, precisa vir junto aqui.
  const investedByMonthWithYear: { label: string; value: number; year: number }[] = [];
  let prevInvestedByKey = baselineInvestedByKey;
  for (let idx = 0; idx < monthlyTotals.length; idx++) {
    const curByKey = investedByKeyByMonth[idx];
    const curYm = monthYms[idx];
    if (prevInvestedByKey !== null) {
      const keys = new Set([...prevInvestedByKey.keys(), ...curByKey.keys()]);
      let delta = 0;
      for (const key of keys) {
        if (automatedStartYm.get(key) === curYm) continue; // mês da migração — artefato, não aporte
        delta += (curByKey.get(key) ?? 0) - (prevInvestedByKey.get(key) ?? 0);
      }
      investedByMonthWithYear.push({ label: evolution[idx].label, value: delta, year: monthMetaYear[idx] });
    }
    prevInvestedByKey = curByKey;
  }
  const investedByMonth = investedByMonthWithYear.map(({ label, value }) => ({ label, value }));

  // ---- aportado REAL no ano corrente até agora — comparação com a coluna
  // "contribution" (planejada) do yearlyBreakdown da "Primeira Milhão"
  // (pedido do Luiz, 04/09: "em 2026 tá escrito que eu devia aportar 30k,
  // mas eu fiz isso?"). Soma só as entradas cujo mês cai no ano corrente —
  // sempre um subconjunto dos últimos 12 meses (jan a dezembro nunca passa
  // de 12 meses atrás de "agora").
  const currentCalendarYear = new Date().getFullYear();
  const realContributionThisYear = investedByMonthWithYear
    .filter((e) => e.year === currentCalendarYear)
    .reduce((sum, e) => sum + e.value, 0);

  // ---- aportes do mês: variação do total investido, por broker+tipo (não
  // posição por posição, não total puro) ----
  // Comparar por security individual quebra sempre que a identidade do ativo
  // muda de fonte (ex: histórico manual agregava "AÇÕES" numa linha só, a
  // Pluggy reporta cada ação separada). Comparar só o TOTAL puro (como era
  // antes, 14/09) tem o mesmo problema do "Aportado real" acima: no mês em
  // que um broker+tipo migra de manual pra automático, a diferença de
  // precisão entre as duas fontes conta como se fosse aporte. Mesma exclusão
  // por broker+tipo aplicada aqui, pra "Investido este mês" (Dashboard) nunca
  // dizer algo diferente do "Aportado real" (Patrimônio) sobre o mesmo mês.
  function investedDelta(curSnaps: typeof all, curYm: number, priorSnaps: typeof all) {
    const curByKey = investedByKey(curSnaps);
    const priorByKey = investedByKey(priorSnaps);
    const keys = new Set([...curByKey.keys(), ...priorByKey.keys()]);
    let delta = 0;
    for (const key of keys) {
      if (automatedStartYm.get(key) === curYm) continue;
      delta += (curByKey.get(key) ?? 0) - (priorByKey.get(key) ?? 0);
    }
    return delta;
  }
  const investedThisMonth = investedDelta(latestSnaps, nowYm, previousSnaps);
  const investedLastMonth = previousSnaps.length > 0 ? investedDelta(previousSnaps, nowYm - 1, beforePreviousSnaps) : null;

  // ---- proventos: soma de DividendPayment do período (11/09: Ação/FII vêm
  // de verdade da Pluggy via GET /investments/{id}/transactions; Fundo é
  // lançamento MANUAL — pedido do Luiz pro fundo VALORA, que a Pluggy não
  // reporta dividendo — mas os dois entram na mesma soma, sem distinção
  // aqui. null = "ainda sem provento coletado/lançado nesse período", nunca
  // 0 fake. Tabela PRÓPRIA (não `PositionSnapshot.dividends`) de propósito
  // — dividendo é um FLUXO ligado à DATA REAL do pagamento, não ao mês em
  // que a gente por acaso já tinha um snapshot daquela posição (ver
  // comentário no schema: BTG só passou a sincronizar Ação/FII por ticker
  // individual a partir de ago/2026, mas o extrato de transações já tinha
  // histórico bem anterior — sem uma tabela própria, jan-jul ficariam pra
  // sempre sem provento nenhum mesmo com dinheiro real recebido). Nunca
  // `activeSnapshotsAsOf` aqui: arrastar o último valor conhecido
  // duplicaria o provento de um mês pro seguinte. ----
  async function dividendsForYm(ym: number): Promise<number | null> {
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    const payments = await prisma.dividendPayment.findMany({ where: { year, month } });
    if (payments.length === 0) return null;
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }
  const dividendsThisMonth = await dividendsForYm(nowYm);
  const dividendsLastMonth = await dividendsForYm(nowYm - 1);

  // ---- proventos por mês do ano corrente, separado Ação x FII (11/09,
  // pedido do Luiz: "gráfico por mês do ano... o que veio do FII e o que
  // veio da Ação... quanto já ganhei de proventos no ano total... traga
  // todos desse ano, de janeiro até agora"). SEMPRE o ano-calendário de
  // verdade (`now`), janeiro até o mês atual — mesmo critério já usado em
  // "Recebido no ano"/"Média mensal" de Projetos (nunca mistura mês do ano
  // passado). Vem de `DividendPayment` (não do snapshot) — cobre um mês
  // mesmo sem `PositionSnapshot` por ticker naquele mês (jan-jul/2026, antes
  // do BTG sincronizar Ação/FII individualmente via Pluggy).
  const nowReal = new Date();
  const currentYear = nowReal.getFullYear();
  const currentMonth = nowReal.getMonth() + 1;
  const dividendPaymentsThisYear = await prisma.dividendPayment.findMany({
    where: { year: currentYear, month: { lte: currentMonth } },
    include: { security: true },
  });
  // `fundo` (11/09) — Luiz pediu lançamento MANUAL de provento pra posição
  // tipo Fundo (a Pluggy não manda isso pra esse tipo, ver pluggySync.ts) e
  // confirmou que deve somar no mesmo total/gráfico agregado, não ficar de
  // fora. Terceira série ao lado de Ação/FII — DividendPayment não distingue
  // "veio da Pluggy" de "lançado à mão", então qualquer tipo com provento
  // registrado aparece aqui automaticamente.
  // De onde veio a grana daquele mês, mas agora separado POR SÉRIE (Ação/
  // FII/Fundo) — pedido do Luiz, 14/09: "quero passar o mouse nas cores da
  // barra e mostrar apenas os itens que fazem parte da cor" (antes o hover
  // misturava tudo do mês, independente de qual segmento colorido o mouse
  // estava). Soma por ativo dentro do mesmo tipo, pro caso raro de a MESMA
  // ação/FII aparecer em duas corretoras dentro do mesmo mês não duplicar
  // linha no hover. Ticker só é um nome de verdade pra Ação/FII (PETR4,
  // HGLG11) — mesma regra já usada em `displayName` no front
  // (Patrimonio.tsx): pra Fundo a Pluggy manda o CNPJ no campo `ticker`
  // (ex: "60.645.828/0001-29"), que não diz nada no hover — usa o nome
  // nesse caso. Só entra quem realmente pagou algo (>0) — nunca lista
  // posição zerada só pra "preencher" o hover.
  function breakdownByAsset(payments: typeof dividendPaymentsThisYear) {
    const map = new Map<string, number>();
    for (const p of payments) {
      if (p.amount <= 0) continue;
      const key = (p.security.type === "Ação" || p.security.type === "FII") && p.security.ticker ? p.security.ticker : p.security.name;
      map.set(key, (map.get(key) ?? 0) + p.amount);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }
  const dividendsByMonth: {
    label: string;
    acao: number;
    fii: number;
    fundo: number;
    acaoBreakdown: { label: string; value: number }[];
    fiiBreakdown: { label: string; value: number }[];
    fundoBreakdown: { label: string; value: number }[];
  }[] = [];
  let dividendsThisYear = 0;
  for (let m = 1; m <= currentMonth; m++) {
    const monthPayments = dividendPaymentsThisYear.filter((p) => p.month === m);
    const acaoPayments = monthPayments.filter((p) => p.security.type === "Ação");
    const fiiPayments = monthPayments.filter((p) => p.security.type === "FII");
    const fundoPayments = monthPayments.filter((p) => p.security.type === "Fundo");
    const acao = acaoPayments.reduce((sum, p) => sum + p.amount, 0);
    const fii = fiiPayments.reduce((sum, p) => sum + p.amount, 0);
    const fundo = fundoPayments.reduce((sum, p) => sum + p.amount, 0);
    dividendsByMonth.push({
      label: new Date(currentYear, m - 1, 1).toLocaleDateString("pt-BR", { month: "short" }),
      acao,
      fii,
      fundo,
      acaoBreakdown: breakdownByAsset(acaoPayments),
      fiiBreakdown: breakdownByAsset(fiiPayments),
      fundoBreakdown: breakdownByAsset(fundoPayments),
    });
    dividendsThisYear += acao + fii + fundo;
  }

  // ---- destaques do mês: maior variação % por CATEGORIA (não por ativo) ----
  // Antes mostrava o ativo individual (ticker/CUSIP) — pra título de renda
  // fixa isso vira um código sem significado nenhum pra ele (ex: "105756CG3",
  // o CUSIP de um bond da Nomad). Trocado pra a mesma categoria já usada na
  // "Alocação de investimentos" logo acima (tipo do ativo, ou o nome da
  // corretora quando ela é "standalone" tipo Nomad/INCO) — sempre uma
  // categoria reconhecível (Renda Fixa, Ação, FII, NOMAD...), nunca um
  // identificador técnico de ativo.
  function totalByCategory(snaps: { marketValue: number; security: { type: string }; broker: { name: string; standalone: boolean } }[]) {
    const map = new Map<string, number>();
    for (const s of snaps) {
      const key = s.broker.standalone ? s.broker.name : s.security.type;
      map.set(key, (map.get(key) ?? 0) + s.marketValue);
    }
    return map;
  }
  const latestByCategory = totalByCategory(latestSnaps);
  const previousByCategory = totalByCategory(previousSnaps);
  const movers = [...latestByCategory.entries()]
    .map(([category, curValue]) => {
      const priorValue = previousByCategory.get(category);
      // categoria não existia no mês anterior — não dá pra saber "quanto
      // mudou", não inventa 0%, só não aparece como destaque
      if (!priorValue) return null;
      const changePct = ((curValue - priorValue) / priorValue) * 100;
      return { category, changePct };
    })
    .filter((m): m is { category: string; changePct: number } => m !== null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);

  // ---- projeção "primeira milhão" (retorno real + aporte mensal, ver services/wealthProjection.ts) ----
  // ---- variação por ATIVO, mês contra mês (relatório mensal, 21/09: "qual
  // foi o investimento que mais rendeu? ou aquele que caiu?") ----
  // Valorização de verdade, SEM aporte: (valor agora - valor antes - dinheiro
  // novo que entrou) / valor antes. Agrupa por tipo+nome de exibição (lotes de
  // Tesouro/CDB somam num papel só) e só entra quem existe nos DOIS meses —
  // posição nova ou recém-migrada de manual pra automático não tem "antes"
  // comparável, então não inventa variação pra ela.
  function assetLabel(s: (typeof latestSnaps)[number]) {
    const useTicker = (s.security.type === "Ação" || s.security.type === "FII") && s.security.ticker;
    return `${s.security.type}|${useTicker ? s.security.ticker : s.security.name}`;
  }
  function byAsset(snaps: typeof latestSnaps) {
    const map = new Map<string, { market: number; invested: number }>();
    for (const sn of snaps) {
      const k = assetLabel(sn);
      const cur = map.get(k) ?? { market: 0, invested: 0 };
      cur.market += sn.marketValue;
      cur.invested += sn.investedAmount;
      map.set(k, cur);
    }
    return map;
  }
  const assetsNow = byAsset(latestSnaps);
  const assetsBefore = byAsset(previousSnaps);
  const positionMovers: { label: string; type: string; marketValue: number; changePct: number }[] = [];
  for (const [k, cur] of assetsNow) {
    const prev = assetsBefore.get(k);
    if (!prev || prev.market <= 0) continue;
    const gain = cur.market - prev.market - (cur.invested - prev.invested);
    const [type, label] = k.split("|");
    // Saldo de conta corrente não é investimento — variação dele é entrada/saída
    // de dinheiro, não rendimento (ex: saldo da Wise indo de US$1.070 a US$27).
    if (type === "Conta Corrente" || label === "Conta Corrente") continue;
    positionMovers.push({ label, type, marketValue: cur.market, changePct: (gain / prev.market) * 100 });
  }
  positionMovers.sort((a, b) => b.changePct - a.changePct);

  // Proventos do mês pedido, por ativo (mesma regra de nome do gráfico anual).
  const dividendRows = await prisma.dividendPayment.findMany({
    where: { year: Math.floor((nowYm - 1) / 12), month: nowYm - Math.floor((nowYm - 1) / 12) * 12 },
    include: { security: true },
  });
  const dividendMap = new Map<string, { value: number; type: string }>();
  for (const p of dividendRows) {
    if (p.amount <= 0) continue;
    const label = (p.security.type === "Ação" || p.security.type === "FII") && p.security.ticker ? p.security.ticker : p.security.name;
    const cur = dividendMap.get(label) ?? { value: 0, type: p.security.type };
    cur.value += p.amount;
    dividendMap.set(label, cur);
  }
  const dividendsBreakdown = [...dividendMap.entries()]
    .map(([label, v]) => ({ label, type: v.type, value: v.value }))
    .sort((a, b) => b.value - a.value);

  const wealthGoal = await prisma.wealthGoal.findFirst();
  const { projection, yearlyBreakdown } = projectFirstMillion(
    total,
    wealthGoal?.targetAmount ?? null,
    wealthGoal?.monthlyContribution ?? 0,
    avgMonthlyReturnPct,
    realContributionThisYear
  );

  res.json({
    hasData: true,
    total,
    previousTotal,
    allocation,
    evolution,
    investedThisMonth,
    investedLastMonth,
    investedByMonth,
    dividendsThisMonth,
    dividendsLastMonth,
    dividendsByMonth,
    dividendsThisYear,
    movers,
    positionMovers,
    dividendsBreakdown,
    wealthGoal,
    avgMonthlyReturnPct,
    projection,
    yearlyBreakdown,
  });
});
