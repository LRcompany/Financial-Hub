import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { prisma } from "../prisma.js";
import { syncBrokerInvestments } from "../services/pluggySync.js";
import { syncOnchainWallet } from "../services/onchainSync.js";
import { parseNomadStatement } from "../services/nomadStatement.js";
import { getUsdToBrlRateOnDate } from "../services/fx.js";
import { getAccounts } from "../services/pluggy.js";

export const brokersRouter = Router();

// Upload de extrato PDF fica só em memória (arquivo pequeno, alguns segundos
// de vida) — nunca grava o PDF em disco, extrai o texto e descarta.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

// POST /api/brokers/:id/statement-preview — extrai texto do PDF (extrato
// mensal, hoje só o formato Nomad/Apex Clearing) e devolve uma prévia
// (posições, saldo FDIC, período) SEM gravar nada no banco. A confirmação é
// um passo separado (statement-confirm) — layout de extrato mudar não
// corrompe dado, na pior das hipóteses a extração falha e mostra aviso pra
// conferência manual em vez de gravar às cegas.
brokersRouter.post("/brokers/:id/statement-preview", upload.single("file"), async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado (campo 'file')" });

  try {
    const parser = new PDFParse({ data: req.file.buffer });
    const { text } = await parser.getText();
    await parser.destroy();

    const parsed = parseNomadStatement(text);
    if (!parsed.periodEnd) {
      return res.status(422).json({ error: "Não consegui identificar o período do extrato — layout inesperado.", parsed });
    }
    const [year, month] = parsed.periodEnd.split("-").map(Number);
    res.json({ parsed, month, year });
  } catch (err) {
    res.status(422).json({ error: `Falha ao ler o PDF: ${(err as Error).message}` });
  }
});

// POST /api/brokers/:id/statement-confirm — grava as posições já revisadas
// (vindas da tela de prévia, possivelmente editadas manualmente antes de
// confirmar). Base de custo (investedAmount) herda do snapshot anterior do
// mesmo ativo (mesma regra do sync on-chain) — um extrato de posição não
// traz preço de compra, então não inventa um custo novo todo mês; só usa o
// valor de mercado como base na primeira vez que aquele ativo aparece.
brokersRouter.post("/brokers/:id/statement-confirm", async (req, res) => {
  const broker = await prisma.broker.findUnique({ where: { id: req.params.id } });
  if (!broker) return res.status(404).json({ error: "Broker não encontrado" });

  const { month, year, periodEnd, positions, fdicBalance } = req.body ?? {};
  if (!month || !year || !periodEnd || !Array.isArray(positions)) {
    return res.status(400).json({ error: "Campos obrigatórios: month, year, periodEnd, positions[]" });
  }

  // Câmbio do dia de fechamento do extrato, não o de hoje — um extrato de
  // julho enviado em agosto (ou revisado depois) não pode recotar julho com
  // o dólar de agosto.
  let usdRate: number;
  try {
    usdRate = await getUsdToBrlRateOnDate(periodEnd);
  } catch (err) {
    return res.status(502).json({ error: `Falha ao buscar cotação USD/BRL: ${(err as Error).message}` });
  }

  async function upsertUsdPosition(securityId: string, name: string, type: string, quantity: number | null, unitValueUsd: number | null, marketValueUsd: number, extra?: { issuer?: string }) {
    await prisma.security.upsert({
      where: { id: securityId },
      update: { name, type, currency: "USD", ...(extra?.issuer ? { issuer: extra.issuer } : {}) },
      create: { id: securityId, name, type, currency: "USD", ...(extra?.issuer ? { issuer: extra.issuer } : {}) },
    });
    const marketValue = marketValueUsd * usdRate;
    const unitValue = unitValueUsd != null ? unitValueUsd * usdRate : null;
    const previous = await prisma.positionSnapshot.findFirst({
      where: { brokerId: broker!.id, securityId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    const investedAmount = previous?.investedAmount ?? marketValue;
    await prisma.positionSnapshot.upsert({
      where: { brokerId_securityId_month_year: { brokerId: broker!.id, securityId, month, year } },
      update: { marketValue, investedAmount, fxRateToBRL: usdRate, quantity, unitValue },
      create: { brokerId: broker!.id, securityId, month, year, marketValue, investedAmount, fxRateToBRL: usdRate, quantity, unitValue },
    });
  }

  let count = 0;
  for (const p of positions as { name: string; cusip: string; type: string; quantity: number; unitValue: number; marketValue: number }[]) {
    if (!p.name || !p.cusip || !p.marketValue) continue;
    await upsertUsdPosition(`MANUAL:${broker.name}:${p.cusip}`, p.name, p.type || "Renda Fixa", p.quantity ?? null, p.unitValue ?? null, p.marketValue);
    count++;
  }
  if (typeof fdicBalance === "number" && fdicBalance > 0) {
    await upsertUsdPosition(
      `MANUAL:${broker.name}:FDIC_CASH`,
      "FDIC Insured Deposit",
      "Moeda",
      null,
      null,
      fdicBalance,
      { issuer: "Saldo em caixa não investido, protegido pelo seguro federal dos EUA (FDIC) até US$250 mil por banco" }
    );
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

// GET /api/credit-cards?month&year — fatura/limite de todo cartão conectado
// via Pluggy, direto da conta (não fica salvo em snapshot — é sempre a foto
// de agora, não faz sentido guardar histórico do "quanto ainda tenho no
// cartão" do jeito que guardamos investimento) + cartão manual (Caixa), cujo
// "usado" vem da soma das parcelas futuras já cadastradas pra ele a partir do
// mês informado (sem limite/disponível/vencimento — não temos essa
// informação sem a Pluggy). month/year são os mesmos do mês que o Luiz está
// navegando no Orçamento — avançar mês faz o "usado" do cartão manual cair
// (parcela que já passou some da conta), até zerar quando não sobrar nenhuma.
brokersRouter.get("/credit-cards", async (req, res) => {
  const now = new Date();
  const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
  const year = req.query.year ? Number(req.query.year) : now.getFullYear();
  const monthStart = new Date(year, month - 1, 1);

  const brokers = await prisma.broker.findMany({ where: { dataSource: "pluggy", pluggyConnectorId: { not: null } } });

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
        cards.push({
          broker: broker.name,
          name: acc.name.trim(),
          usedAmount: acc.balance,
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
    const total = agg._sum.amount ?? 0;
    if (total <= 0) continue;
    cards.push({
      broker: cardLabel,
      name: `${cardLabel} (sem Pluggy — parcelamento em andamento)`,
      usedAmount: total,
      availableLimit: null,
      creditLimit: null,
      minimumPayment: null,
      dueDate: null,
      brand: null,
    });
  }

  res.json({ cards });
});
