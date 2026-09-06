import { Router } from "express";
import { prisma } from "../prisma.js";
import { syncBrokerInvestments } from "../services/pluggySync.js";
import { syncAllBrokersCreditCardTransactions } from "../services/pluggyTransactionSync.js";
import { syncOnchainWallet } from "../services/onchainSync.js";
import { getUsdToBrlRate } from "../services/fx.js";
import { getAccounts } from "../services/pluggy.js";

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
  if (broker.archivedAt) return res.status(409).json({ error: `${broker.name} está arquivada — desarquive antes de sincronizar.` });

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

// POST /api/brokers/:id/archive — "excluir" uma conexão que o Luiz não usa
// mais, sem apagar histórico: toda corretora do sistema tem PositionSnapshot
// real (até a herdada da planilha original), então um DELETE de verdade
// sempre teria que escolher entre recusar tudo ou apagar dado — arquivar
// tira a corretora das telas ativas (Patrimônio, fatura de cartão, sync
// automático e manual) sem decidir isso por ele. Reversível a qualquer hora.
brokersRouter.post("/brokers/:id/archive", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  const updated = await prisma.broker.update({ where: { id: broker.id }, data: { archivedAt: new Date() } });
  res.json(updated);
});

// POST /api/brokers/:id/unarchive — traz a conexão de volta pras telas
// ativas. Nada precisa ser "restaurado": os PositionSnapshot/Transaction
// nunca saíram do banco, só ficaram fora do filtro enquanto arquivada.
brokersRouter.post("/brokers/:id/unarchive", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  const updated = await prisma.broker.update({ where: { id: broker.id }, data: { archivedAt: null } });
  res.json(updated);
});

// Corretoras sem sync automático (nem Pluggy, nem consulta on-chain) onde o
// Luiz atualiza o valor olhando o app dele mesmo — Nomad, INCO e Wise. Antes
// (até 01/09) isso era feito mandando um PDF de extrato pra gente tentar ler
// (só funcionava de verdade pra Nomad, formato Apex Clearing — INCO nunca
// teria um parser certo sem um extrato real dele pra calibrar). Luiz pediu
// pra trocar por um popup direto: ele vê a lista do que já tá cadastrado e
// digita o valor atual de cada um, mês a mês — sem extrato, sem parser.
//
// Cada corretora tem uma realidade diferente de campo (01/09, ajustado depois
// de ver a tela real): Nomad é título/ETF de verdade (tem tipo e moeda
// variados, mas o que importa acompanhar é investido vs. atual, não
// qtd./preço unitário aqui). Wise é só a reserva de emergência, sempre
// "Renda Fixa" (nunca outro tipo) — moeda pode variar, mas não tem custo de
// aquisição separado do valor atual (é liquidez, não investimento). INCO é
// sempre em Real, sem quantidade, e os itens de verdade são só os
// empreendimentos (real estate crowdfunding) — "CDB 110%"/"ATIVOS" são
// resíduo de um formato antigo de acompanhar a carteira (dados de 2024/2025,
// antes de virar item por empreendimento); ficam de fora do popup mas o
// histórico deles continua no banco, intocado.
interface PositionFieldConfig {
  currency: "USD" | "BRL" | "selectable";
  showType: boolean;
  showQuantity: boolean;
  showUnitValue: boolean;
  showInvestedAmount: boolean;
  fixedType?: string;
  excludeSecurityNames?: string[];
}

const MANUAL_POSITION_CONFIG: Record<string, PositionFieldConfig> = {
  NOMAD: {
    currency: "selectable",
    showType: true,
    showQuantity: false,
    showUnitValue: false,
    showInvestedAmount: true,
    // "FDIC Insured Deposit" é a conta corrente (caixa parado, não é
    // investimento) e "USD" era um bucket de "valor total" agregado — os 2
    // duplicavam/misturavam com a soma dos 3 títulos de verdade (confirmado
    // por ele, 01/09). Ficam de fora, histórico intocado.
    excludeSecurityNames: ["FDIC Insured Deposit", "USD"],
  },
  WISE: {
    currency: "selectable",
    showType: false,
    showQuantity: false,
    showUnitValue: false,
    showInvestedAmount: false,
    fixedType: "Renda Fixa",
    // "CDB MAXIMA" e "FUNDO" não são tocados desde 03/2023 — resíduo de uma
    // carteira antiga, não existem mais. Confirmado (01/09): só sobra UM
    // ativo de verdade aqui, o saldo da conta corrente (era "CDB - Liquidez
    // Diária", renomeado — mesma posição, mesmo histórico, só o nome mudou).
    excludeSecurityNames: ["CDB MAXIMA", "FUNDO"],
  },
  INCO: {
    currency: "BRL",
    showType: false,
    showQuantity: false,
    showUnitValue: false,
    showInvestedAmount: true,
    fixedType: "Renda Fixa",
    excludeSecurityNames: ["ATIVOS", "CDB 110%"],
  },
};

// GET /api/brokers/:id/positions — última posição conhecida de cada ativo
// dessa corretora (não só a "ativa hoje" pela janela de 2 meses do
// Patrimônio — é justamente o ativo que ficou pra trás que mais precisa
// aparecer aqui pra ser atualizado). Fica de fora o que já está zerado dos
// dois lados (marketValue e investedAmount) e o que a config exclui por
// nome (resíduo de formato antigo, ver comentário acima).
brokersRouter.get("/brokers/:id/positions", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  const fieldConfig = MANUAL_POSITION_CONFIG[broker.name];
  if (!fieldConfig) {
    return res.status(400).json({ error: `${broker.name} não está configurada pra atualização manual de posições.` });
  }

  const snapshots = await prisma.positionSnapshot.findMany({
    where: { brokerId: broker.id },
    include: { security: true },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const latestBySecurity = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestBySecurity.has(s.securityId)) latestBySecurity.set(s.securityId, s);
  }

  const positions = [...latestBySecurity.values()]
    .filter((s) => s.marketValue > 0 || s.investedAmount > 0)
    .filter((s) => !fieldConfig.excludeSecurityNames?.includes(s.security.name))
    .map((s) => {
      // O banco guarda tudo em BRL (marketValue/unitValue/investedAmount já
      // convertidos na hora de salvar) — pra reexibir no formulário precisa
      // desconverter de volta pra USD usando a taxa daquele snapshot
      // específico, senão o campo mostraria um número em BRL com o rótulo
      // "USD" do lado, e o Luiz digitaria por cima olhando o valor errado no
      // app dele (que mostra USD). Ao salvar de novo, a conversão usa a
      // cotação de HOJE, não essa antiga — é sempre assim que preço
      // convertido funciona aqui.
      const fx = s.fxRateToBRL;
      const usd = s.security.currency === "USD" && fx;
      // Arredonda pra 2 casas na volta — dividir por uma taxa de câmbio
      // sempre sobra resíduo de ponto flutuante (7513.170000000002), e isso
      // ia aparecer digitável no campo, cortado, sem servir pra nada real
      // (ninguém digita centavo com 12 casas decimais).
      const round2 = (n: number) => Math.round(n * 100) / 100;
      return {
        securityId: s.securityId,
        name: s.security.name,
        type: s.security.type,
        currency: s.security.currency,
        quantity: s.quantity,
        unitValue: usd && s.unitValue != null ? round2(s.unitValue / fx) : s.unitValue,
        marketValue: usd ? round2(s.marketValue / fx) : s.marketValue,
        investedAmount: usd ? round2(s.investedAmount / fx) : s.investedAmount,
        lastUpdated: `${String(s.month).padStart(2, "0")}/${s.year}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  res.json({ positions, brokerLastSyncedAt: broker.lastSyncedAt, fieldConfig });
});

// PUT /api/brokers/:id/positions — grava um PositionSnapshot novo (mês/ano
// de hoje) pra cada posição enviada, uma por uma — é assim que o histórico
// mês a mês continua existindo (nunca sobrescreve o snapshot antigo, só
// soma um novo). Ativo sem securityId é novo (Luiz adicionou no popup).
// investedAmount: pra corretora com `showInvestedAmount` (Nomad, INCO) vem
// digitado por ele — é um valor real que ele está informando, não estamos
// inventando; pras demais (Wise) continua herdando do snapshot anterior
// (mesma regra de sempre: atualizar o valor de mercado não pode inventar um
// custo de aquisição novo sozinho).
brokersRouter.put("/brokers/:id/positions", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  const fieldConfig = MANUAL_POSITION_CONFIG[broker.name];
  if (!fieldConfig) {
    return res.status(400).json({ error: `${broker.name} não está configurada pra atualização manual de posições.` });
  }

  const { positions } = req.body ?? {};
  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: "positions precisa ser uma lista não vazia" });
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  let usdRate: number | null = null;
  let count = 0;

  for (const raw of positions as {
    securityId?: string;
    name?: string;
    type?: string;
    currency?: string;
    quantity?: number | null;
    unitValue?: number | null;
    marketValue?: number;
    investedAmount?: number | null;
  }[]) {
    const name = raw.name?.trim();
    if (!name || typeof raw.marketValue !== "number") continue;

    const assetCurrency = fieldConfig.currency === "selectable" ? (raw.currency === "USD" ? "USD" : "BRL") : fieldConfig.currency;
    let marketValue = raw.marketValue;
    let unitValue = fieldConfig.showUnitValue && typeof raw.unitValue === "number" ? raw.unitValue : null;
    // Valor digitado na MOEDA ORIGINAL (USD, pro caso da Nomad) — NÃO converte
    // ainda aqui (ver por quê logo abaixo, no cálculo de investedAmount).
    const investedAmountRawInput = fieldConfig.showInvestedAmount && typeof raw.investedAmount === "number" ? raw.investedAmount : null;
    const quantity = fieldConfig.showQuantity && typeof raw.quantity === "number" ? raw.quantity : null;

    if (assetCurrency === "USD") {
      if (usdRate == null) {
        try {
          usdRate = await getUsdToBrlRate();
        } catch (err) {
          return res.status(502).json({ error: `Falha ao buscar cotação USD/BRL: ${(err as Error).message}` });
        }
      }
      marketValue = marketValue * usdRate;
      if (unitValue != null) unitValue = unitValue * usdRate;
    }

    const type = fieldConfig.fixedType ?? raw.type ?? "Outro";
    const securityId = raw.securityId || `MANUAL:${broker.name}:${name}`.toUpperCase();
    await prisma.security.upsert({
      where: { id: securityId },
      update: { name, type, currency: assetCurrency },
      create: { id: securityId, name, type, currency: assetCurrency },
    });

    const previous = await prisma.positionSnapshot.findFirst({
      where: { brokerId: broker.id, securityId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    let investedAmount: number;
    if (investedAmountRawInput == null) {
      investedAmount = previous?.investedAmount ?? marketValue;
    } else if (assetCurrency === "USD") {
      // Achado real (05/09, print do Luiz comparando 3 posições da Nomad que
      // subiram todas ~1,39% — a mesma % em ativos sem relação nenhuma entre
      // si, ETF e 2 bonds diferentes): reconverter o valor investido TOTAL
      // pela cotação de HOJE todo mês fazia o câmbio vazar pro "aportado" —
      // mesmo sem aportar 1 dólar a mais, o BRL subia junto com o dólar. Em
      // vez disso, converte só a DIFERENÇA em dólar (o aporte/resgate de
      // verdade) pela cotação de hoje, e soma em cima do BRL que já estava
      // registrado — histórico velho nunca é recotado, só o que muda de fato.
      const previousRawInvested = previous ? (previous.fxRateToBRL ? previous.investedAmount / previous.fxRateToBRL : previous.investedAmount) : null;
      if (previous && previousRawInvested != null) {
        const deltaRaw = investedAmountRawInput - previousRawInvested;
        investedAmount = previous.investedAmount + deltaRaw * usdRate!;
      } else {
        investedAmount = investedAmountRawInput * usdRate!; // primeira vez — nada pra preservar ainda
      }
    } else {
      investedAmount = investedAmountRawInput; // BRL: sem conversão, sem essa pegadinha
    }

    await prisma.positionSnapshot.upsert({
      where: { brokerId_securityId_month_year: { brokerId: broker.id, securityId, month, year } },
      update: { marketValue, investedAmount, quantity, unitValue, fxRateToBRL: assetCurrency === "USD" ? usdRate : null },
      create: { brokerId: broker.id, securityId, month, year, marketValue, investedAmount, quantity, unitValue, fxRateToBRL: assetCurrency === "USD" ? usdRate : null },
    });
    count++;
  }

  await prisma.broker.update({ where: { id: broker.id }, data: { lastSyncedAt: new Date() } });
  res.json({ saved: true, count, month, year });
});

interface PluggyAccountRaw {
  id: string;
  type: string;
  name: string;
  balance: number;
  currencyCode: string;
  creditData?: {
    brand: string | null;
    balanceDueDate: string | null;
    availableCreditLimit: number | null;
    minimumPayment: number | null;
    creditLimit: number | null;
  } | null;
}

// Cartão sem conector na Pluggy (ex: Caixa — Luiz não usa mais mas ainda tem
// parcelamento correndo lá). "Manual" aqui não é: "" digitado por ele — é
// deduzido do que já está gravado em UpcomingInstallment (a fatura real que
// ele compartilhou), então nunca é um número inventado. Os cartões físicos
// "5709" e "2220" são o MESMO cartão Caixa na prática (confirmado por ele),
// por isso uma label só — não dois cartões na lista.
const MANUAL_CARDS = ["Caixa"];

// Limite real informado pelo Luiz diretamente (30/08) — esse cartão não está
// na Pluggy, então não tem como ler o limite de nenhuma API; sem isso não
// dava pra mostrar "resta do limite" pra ele, só o "usado".
const MANUAL_CARD_LIMITS: Record<string, number> = { Caixa: 58000 };

// GET /api/credit-cards?month&year — fatura/limite de todo cartão conectado
// via Pluggy, direto da conta (não fica salvo em snapshot — é sempre a foto
// de agora, não faz sentido guardar histórico do "quanto ainda tenho no
// cartão" do jeito que guardamos investimento) + cartão manual (Caixa), cujo
// "usado" vem da soma das parcelas futuras já cadastradas pra ele a partir do
// mês informado — sem vencimento/mínimo (não temos isso sem a Pluggy), mas
// COM limite (MANUAL_CARD_LIMITS, informado pelo Luiz direto) pra poder
// mostrar "usado/resta/limite" igual aos cartões da Pluggy. month/year são os
// mesmos do mês que o Luiz está navegando no Orçamento — avançar mês faz o
// "usado" do cartão manual cair (parcela que já passou some da conta), até
// sumir da lista quando não sobrar nenhuma.
//
// Cartão Pluggy (BTG/C6/...) em mês diferente do atual (01/09): o "usado"
// que a Pluggy devolve é sempre o valor AO VIVO de hoje, o banco não tem
// endpoint de "usado em outubro" pro futuro (nem histórico real pro
// passado). Luiz pediu que navegar mês a mês reflita as parcelas que vão
// sendo pagas — decisão dele: mostrar uma ESTIMATIVA (marcada como tal, não
// esconder que é cálculo nosso): usado(mês) = usado(hoje) − parcelas dessa
// corretora com vencimento entre hoje e o mês pedido (futuro), ou usado(hoje)
// + parcelas com vencimento entre o mês pedido e hoje (passado, "como teria
// sido antes das parcelas já pagas desde então"). Isso é uma estimativa
// grosseira de propósito — já confirmamos antes (30/08) que o BTG não trava
// o parcelamento inteiro no limite, então a estimativa pode não bater exato
// com o número real do banco quando o mês chegar; o campo `estimated` avisa
// o frontend pra rotular isso.
brokersRouter.get("/credit-cards", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const monthStart = new Date(year, month - 1, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const isDifferentMonth = monthStart.getTime() !== currentMonthStart.getTime();

  const brokers = await prisma.broker.findMany({ where: { dataSource: "pluggy", pluggyConnectorId: { not: null }, archivedAt: null } });

  const cards: {
    broker: string;
    name: string;
    usedAmount: number;
    availableLimit: number | null;
    creditLimit: number | null;
    minimumPayment: number | null;
    dueDate: string | null;
    brand: string | null;
    estimated: boolean;
  }[] = [];

  for (const broker of brokers) {
    try {
      const accounts = (await getAccounts(broker.pluggyConnectorId!)) as { results: PluggyAccountRaw[] };
      for (const acc of accounts.results) {
        if (acc.type !== "CREDIT" || !acc.creditData) continue;
        // Preferir limite - disponível em vez de `balance` direto: pro C6 a
        // Pluggy reporta `balance` e `usedAmount` zerados mesmo com limite
        // disponível reduzido (gap real do conector, não é falta de uso do
        // cartão) — conferido direto na API em 29/08: creditLimit 101.400,
        // availableCreditLimit 66.901,51, `balance`/`usedAmount` = 0, quando
        // deveria refletir ~34.498,49 em uso. Pro BTG os dois batem igual
        // (balance já é exatamente creditLimit - availableCreditLimit), então
        // essa conta não muda nada onde já funcionava, só corrige o C6.
        const creditLimit = acc.creditData.creditLimit;
        const availableLimit = acc.creditData.availableCreditLimit;
        let usedAmount = creditLimit != null && availableLimit != null ? creditLimit - availableLimit : acc.balance;
        let estimated = false;

        if (isDifferentMonth) {
          const [from, to] = monthStart > currentMonthStart ? [currentMonthStart, monthStart] : [monthStart, currentMonthStart];
          const agg = await prisma.upcomingInstallment.aggregate({
            where: { cardLabel: broker.name, dueDate: { gte: from, lt: to } },
            _sum: { amount: true },
          });
          const delta = agg._sum.amount ?? 0;
          usedAmount = monthStart > currentMonthStart ? Math.max(0, usedAmount - delta) : usedAmount + delta;
          estimated = true;
        }

        const availableLimitAdjusted = creditLimit != null ? creditLimit - usedAmount : acc.creditData.availableCreditLimit ?? 0;

        cards.push({
          broker: broker.name,
          name: acc.name.trim(),
          usedAmount,
          availableLimit: availableLimitAdjusted,
          creditLimit: acc.creditData.creditLimit ?? 0,
          minimumPayment: estimated ? null : acc.creditData.minimumPayment,
          dueDate: estimated ? null : acc.creditData.balanceDueDate,
          brand: acc.creditData.brand,
          estimated,
        });
      }
    } catch {
      // corretora sem cartão, ou API fora do ar — não trava o resto
    }
  }

  for (const cardLabel of MANUAL_CARDS) {
    const agg = await prisma.upcomingInstallment.aggregate({
      where: { cardLabel, dueDate: { gte: monthStart } },
      _sum: { amount: true },
    });
    const usedAmount = agg._sum.amount ?? 0;
    if (usedAmount <= 0) continue;
    const creditLimit = MANUAL_CARD_LIMITS[cardLabel] ?? null;
    cards.push({
      broker: cardLabel,
      name: cardLabel,
      usedAmount,
      availableLimit: creditLimit != null ? creditLimit - usedAmount : null,
      creditLimit,
      minimumPayment: null,
      dueDate: null,
      brand: null,
      estimated: false,
    });
  }

  res.json({ cards });
});

// POST /api/credit-cards/sync-transactions — puxa as transações reais de
// TODOS os cartões de crédito conectados via Pluggy (BTG, C6...) de uma vez.
// Grava Transaction (source: "pluggy", externalId evita duplicar em sync
// repetido) e, pra compra parcelada, as parcelas futuras restantes em
// UpcomingInstallment — automatizando o que antes era feito à mão batendo
// fatura (ver Caixa em 29/08). Tenta categorizar automaticamente (mapeamento
// conservador de categoria da Pluggy + CategorizationRule já aprendida);
// o que não bate com confiança fica sem categoria, pra revisar manualmente.
brokersRouter.post("/credit-cards/sync-transactions", async (_req, res) => {
  const result = await syncAllBrokersCreditCardTransactions();
  res.json(result);
});
