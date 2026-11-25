// Histórico de sincronização (25/11) — alimenta a ferramenta `historico_sync`
// do conector MCP. Registra cada execução (quem disparou, quanto tempo, deu
// certo ou não, resumo) sem nunca atrapalhar o sync: falha ao gravar o log só
// vira aviso no console.
import { prisma } from "../prisma.js";

export type SyncKind = "cartao" | "investimentos" | "onchain" | "cambio";

export async function logSync<T>(
  kind: SyncKind,
  brokerName: string | null,
  trigger: string,
  fn: () => Promise<T>,
  summarize: (r: T) => string = (r) => JSON.stringify(r).slice(0, 500)
): Promise<T> {
  const startedAt = new Date();
  const save = (ok: boolean, summary: string | null, error: string | null) =>
    prisma.syncRun
      .create({ data: { kind, brokerName, trigger, startedAt, finishedAt: new Date(), ok, summary, error } })
      .catch((e) => console.warn("[sync log] não gravou:", (e as Error).message));
  try {
    const result = await fn();
    let summary: string | null = null;
    try {
      summary = summarize(result);
    } catch {
      summary = null;
    }
    await save(true, summary, null);
    return result;
  } catch (err) {
    await save(false, null, (err as Error).message.slice(0, 500));
    throw err;
  }
}
