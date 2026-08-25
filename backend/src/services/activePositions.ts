import { prisma } from "../prisma.js";

export async function fetchAllSnapshots() {
  return prisma.positionSnapshot.findMany({
    include: { security: true, broker: true },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export type Snap = Awaited<ReturnType<typeof fetchAllSnapshots>>[number];

const ACTIVE_WINDOW_MONTHS = 2; // sem snapshot há mais de 2 meses = corretora encerrada, não conta mais
export const yearMonth = (y: number, m: number) => y * 12 + m;

/**
 * "O que eu tinha em carteira, na visão de cutoffYm" — snapshot mais recente
 * de cada (broker, security) que já existia até aquele ponto, contando só se
 * ainda estava "vivo" (dentro da janela de atividade).
 *
 * Regra extra pra broker que migrou de planilha manual pra fonte automática
 * (Pluggy — BTG, C6, 99, Sofisa — ou consulta on-chain — Phantom): uma vez
 * que existe QUALQUER snapshot `pluggy:*`/`onchain:*` pra aquele broker, os
 * Security antigos `MANUAL:*` do MESMO broker somem — senão o mesmo dinheiro
 * conta duas vezes (a linha manual estimada e o dado automático são o mesmo
 * saldo, não dois).
 */
export function activeSnapshotsAsOf(all: Snap[], cutoffYm: number): Snap[] {
  // "Esse broker já tinha dado automático nesse ponto do tempo?" — não pode
  // ser uma checagem global (senão exclui a fonte automática do passado
  // inteiro, antes dela sequer existir, e o histórico manual desaparece com
  // ela). Só exclui o manual de um mês em que o automático JÁ estava rodando
  // pra aquele broker.
  const automatedStartYmByBroker = new Map<string, number>();
  for (const s of all) {
    if (!s.securityId.startsWith("pluggy:") && !s.securityId.startsWith("onchain:")) continue;
    const symd = yearMonth(s.year, s.month);
    const current = automatedStartYmByBroker.get(s.brokerId);
    if (current === undefined || symd < current) automatedStartYmByBroker.set(s.brokerId, symd);
  }

  const seen = new Set<string>();
  const result: Snap[] = [];
  for (const s of all) {
    const symd = yearMonth(s.year, s.month);
    if (symd > cutoffYm) continue;

    if (s.securityId.startsWith("MANUAL:")) {
      const automatedStart = automatedStartYmByBroker.get(s.brokerId);
      if (automatedStart !== undefined && cutoffYm >= automatedStart) continue;
    }

    const key = `${s.brokerId}:${s.securityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cutoffYm - symd <= ACTIVE_WINDOW_MONTHS) result.push(s);
  }
  return result;
}
