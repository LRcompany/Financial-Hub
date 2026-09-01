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
const MANUAL_POSITION_BROKERS = new Set(["NOMAD", "INCO", "WISE"]);

// GET /api/brokers/:id/positions — última posição conhecida de cada ativo
// dessa corretora (não só a "ativa hoje" pela janela de 2 meses do
// Patrimônio — é justamente o ativo que ficou pra trás que mais precisa
// aparecer aqui pra ser atualizado). Fica de fora só o que já está zerado
// dos dois lados (marketValue e investedAmount) — posição encerrada não
// precisa reaparecer no popup toda vez.
brokersRouter.get("/brokers/:id/positions", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  if (!MANUAL_POSITION_BROKERS.has(broker.name)) {
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
    .map((s) => {
      // O banco guarda tudo em BRL (marketValue/unitValue já convertidos na
      // hora de salvar) — pra reexibir no formulário precisa desconverter de
      // volta pra USD usando a taxa daquele snapshot específico, senão o
      // campo mostraria um número em BRL com o rótulo "USD" do lado, e o
      // Luiz digitaria por cima olhando o valor errado no app dele (que
      // mostra USD). Ao salvar de novo, a conversão usa a cotação de HOJE,
      // não essa antiga — é sempre assim que preço convertido funciona aqui.
      const fx = s.fxRateToBRL;
      const usd = s.security.currency === "USD" && fx;
      return {
        securityId: s.securityId,
        name: s.security.name,
        type: s.security.type,
        currency: s.security.currency,
        quantity: s.quantity,
        unitValue: usd && s.unitValue != null ? s.unitValue / fx : s.unitValue,
        marketValue: usd ? s.marketValue / fx : s.marketValue,
        lastUpdated: `${String(s.month).padStart(2, "0")}/${s.year}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  res.json({ positions, brokerLastSyncedAt: broker.lastSyncedAt });
});

// PUT /api/brokers/:id/positions — grava um PositionSnapshot novo (mês/ano
// de hoje) pra cada posição enviada, uma por uma — é assim que o histórico
// mês a mês continua existindo (nunca sobrescreve o snapshot antigo, só
// soma um novo). Ativo sem securityId é novo (Luiz adicionou no popup);
// investedAmount herda do snapshot anterior do mesmo ativo (mesma regra já
// usada no sync on-chain e no lançamento manual avulso) — atualizar o valor
// de mercado não pode inventar um custo de aquisição novo.
brokersRouter.put("/brokers/:id/positions", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  if (!MANUAL_POSITION_BROKERS.has(broker.name)) {
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
  }[]) {
    const name = raw.name?.trim();
    if (!name || typeof raw.marketValue !== "number") continue;

    const assetCurrency = raw.currency === "USD" ? "USD" : "BRL";
    let marketValue = raw.marketValue;
    let unitValue = typeof raw.unitValue === "number" ? raw.unitValue : null;
    const quantity = typeof raw.quantity === "number" ? raw.quantity : null;

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

    const securityId = raw.securityId || `MANUAL:${broker.name}:${name}`.toUpperCase();
    await prisma.security.upsert({
      where: { id: securityId },
      update: { name, type: raw.type || "Outro", currency: assetCurrency },
      create: { id: securityId, name, type: raw.type || "Outro", currency: assetCurrency },
    });

    const previous = await prisma.positionSnapshot.findFirst({
      where: { brokerId: broker.id, securityId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    const investedAmount = previous?.investedAmount ?? marketValue;

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
brokersRouter.get("/credit-cards", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const monthStart = new Date(year, month - 1, 1);

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
        const usedAmount = creditLimit != null && availableLimit != null ? creditLimit - availableLimit : acc.balance;

        cards.push({
          broker: broker.name,
          name: acc.name.trim(),
          usedAmount,
          availableLimit: acc.creditData.availableCreditLimit ?? 0,
          creditLimit: acc.creditData.creditLimit ?? 0,
          minimumPayment: acc.creditData.minimumPayment,
          dueDate: acc.creditData.balanceDueDate,
          brand: acc.creditData.brand,
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
