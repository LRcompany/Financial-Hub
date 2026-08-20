import { generateDueOccurrences } from "../services/recurrence.js";

/**
 * Job diário — roda via cron (ex: node-cron ou cron do sistema no droplet).
 * TODO: adicionar aqui o sync de transações da Pluggy quando a integração
 * de sync completa estiver pronta (ver services/pluggy.ts).
 */
export async function runDailySync() {
  console.log(`[dailySync] iniciando — ${new Date().toISOString()}`);
  await generateDueOccurrences();
  console.log("[dailySync] concluído");
}
