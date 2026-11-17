// Agendador simples em processo — sem dependência nova (node-cron etc.),
// só setInterval. Justificativa: o backend já roda como processo persistente
// (systemd/pm2 no droplet), e a única tarefa recorrente hoje é "sincronizar
// transação de cartão 1x por dia" — não precisa de infra de fila/cron externo
// pra isso.
//
// Por que 1x/dia, não "quando passar 4-5 dias desde a última transação": a
// própria Pluggy só resincroniza com o banco 1x por dia por conta própria
// (documentado — ver docs/blueprint.md, "Confirmado na documentação oficial
// 01/09"), e o lookback window dela (4-5 dias corridos) já cobre transação
// atrasada sozinho. Rodar nosso sync mais de 1x/dia não traria dado mais
// novo, só bateria a API à toa. Rodar baseado em "dias desde a última
// transação" seria mais complexo pro mesmo resultado prático.
import { runDataHealth } from "./integrity.js";
import { syncAllBrokersCreditCardTransactions } from "./pluggyTransactionSync.js";
import { linkManualPurchases } from "./purchases.js";
import { prisma } from "../prisma.js";
import { syncBrokerInvestments } from "./pluggySync.js";
import { syncOnchainWallet } from "./onchainSync.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Espera 1 minuto após o boot antes do primeiro sync — dá tempo do resto do
// servidor subir (ex: rodando local logo após `npm run dev`, sem corrida).
const FIRST_RUN_DELAY_MS = 60 * 1000;

async function runSync() {
  const startedAt = new Date().toISOString();
  try {
    const result = await syncAllBrokersCreditCardTransactions();
    console.log(
      `[scheduler] sync de transação de cartão em ${startedAt}: ${result.transactionsSynced} nova(s), ` +
        `${result.transactionsReconciled} reconciliada(s) (pendente virou confirmada), ` +
        `${result.installmentsCreated} parcela(s) futura(s), ${result.datesUpdated} data(s) corrigida(s), ${result.futureBilledRemoved} parcela(s) de fatura futura removida(s), ${result.categorizedCount} categorizada(s) sozinha(s).`
    );
  } catch (err) {
    // Nunca deixa o agendador matar o processo por causa de uma falha de
    // rede/Pluggy — só loga e tenta de novo no próximo ciclo.
    console.error(`[scheduler] falha no sync automático de ${startedAt}:`, (err as Error).message);
  }
  // Parcela digitada (sem Pluggy) também é uma compra só (05/11, ver purchases.ts).
  try {
    const log = await linkManualPurchases();
    if (log.length) console.log(`[compras] ${log.length} compra(s) digitada(s) ligada(s)/ajustada(s)`);
  } catch (err) {
    console.error("[compras] falhou:", (err as Error).message);
  }
  // Saúde dos dados logo depois do sync (27/10) — qualquer regra quebrada
  // fica registrada no log com o que quebrou (e aparece no app na hora).
  try {
    const health = await runDataHealth();
    const summary = health.issues.map((i) => `${i.severity}: ${i.title} (${i.total})`).join("; ");
    console.log(`[saúde dos dados] ${health.ok ? "ok" : "COM ERRO"}${summary ? ` — ${summary}` : ""}`);
  } catch (err) {
    console.error("[saúde dos dados] falhou:", (err as Error).message);
  }
}

/** Chamar uma vez, na subida do servidor (ver server.ts). */
export function startCreditCardSyncScheduler() {
  setTimeout(() => {
    runSync();
    setInterval(runSync, ONE_DAY_MS);
  }, FIRST_RUN_DELAY_MS);
  console.log("[scheduler] sync automático de transação de cartão agendado (1x/dia).");
}

// ---- Investimentos 1x/dia (17/11, Luiz: "ative") ----
// Antes os investimentos só atualizavam no botão Sincronizar — a "foto" de
// outubro ficou sem o CDB de R$20 mil comprado em 30/10, e o rendimento do mês
// (valor final − inicial − aportes) dependia de quando alguém clicava. Agora
// roda sozinho todo dia num horário FIXO: 21:00 UTC = 18:00 de Brasília, depois
// da atualização diária da Pluggy (os itens atualizam entre ~13h e 16h de
// Brasília) e ainda no mesmo dia nos dois fusos — a foto do último dia do mês
// cai no mês certo e vira o "valor final" dele. Corretora conectada (Pluggy) e
// carteira on-chain; corretora manual continua sendo digitada no dia 1.
const INVESTMENT_SYNC_UTC_HOUR = 21;

export async function syncAllInvestments() {
  const brokers = await prisma.broker.findMany({ where: { archivedAt: null } });
  const done: string[] = [];
  for (const b of brokers) {
    try {
      if (b.dataSource === "pluggy" && b.pluggyConnectorId) {
        const r = await syncBrokerInvestments(b.id, b.pluggyConnectorId);
        done.push(`${b.name} ${r.investmentsCount} posição(ões)/${r.movementsSynced} mov.`);
      } else if (b.dataSource === "onchain_query" && b.onchainAddress) {
        await syncOnchainWallet(b.id);
        done.push(b.name);
      }
    } catch (err) {
      // Uma corretora com problema não impede as outras.
      console.error(`[investimentos] ${b.name} falhou:`, (err as Error).message);
    }
  }
  return done;
}

async function runInvestmentSync() {
  try {
    const done = await syncAllInvestments();
    console.log(`[investimentos] sync automático em ${new Date().toISOString()}: ${done.join(", ")}`);
  } catch (err) {
    console.error("[investimentos] sync automático falhou:", (err as Error).message);
  }
  try {
    const health = await runDataHealth();
    const summary = health.issues.map((i) => `${i.severity}: ${i.title} (${i.total})`).join("; ");
    console.log(`[saúde dos dados] ${health.ok ? "ok" : "COM ERRO"}${summary ? ` — ${summary}` : ""}`);
  } catch (err) {
    console.error("[saúde dos dados] falhou:", (err as Error).message);
  }
}

/** Milissegundos até a próxima `hour`:00 UTC. */
export function msUntilUtcHour(hour: number, now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/** Chamar uma vez, na subida do servidor (ver server.ts). */
export function startInvestmentSyncScheduler() {
  const wait = msUntilUtcHour(INVESTMENT_SYNC_UTC_HOUR);
  setTimeout(() => {
    runInvestmentSync();
    setInterval(runInvestmentSync, ONE_DAY_MS);
  }, wait);
  console.log(`[scheduler] sync automático de investimentos agendado (todo dia às ${INVESTMENT_SYNC_UTC_HOUR}:00 UTC, próximo em ${Math.round(wait / 60000)} min).`);
}
