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
import { syncAllBrokersCreditCardTransactions } from "./pluggyTransactionSync.js";

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
        `${result.installmentsCreated} parcela(s) futura(s), ${result.categorizedCount} categorizada(s) sozinha(s).`
    );
  } catch (err) {
    // Nunca deixa o agendador matar o processo por causa de uma falha de
    // rede/Pluggy — só loga e tenta de novo no próximo ciclo.
    console.error(`[scheduler] falha no sync automático de ${startedAt}:`, (err as Error).message);
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
