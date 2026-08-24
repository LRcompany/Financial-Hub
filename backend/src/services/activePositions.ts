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
 * Regra extra pra broker que migrou de planilha manual pra sync da Pluggy
 * (BTG, C6, 99, Sofisa): uma vez que existe QUALQUER snapshot `pluggy:*`
 * pra aquele broker, os Security antigos `MANUAL:*` do MESMO broker somem —
 * senão o mesmo dinheiro conta duas vezes (a linha agregada manual "AÇÕES" e
 * as ações individuais que a Pluggy reporta são o mesmo saldo, não dois).
 */
export function activeSnapshotsAsOf(all: Snap[], cutoffYm: number): Snap[] {
  // "Esse broker já tinha dado da Pluggy nesse ponto do tempo?" — não pode
  // ser uma checagem global (senão exclui a Pluggy do passado inteiro, antes
  // dela sequer existir, e o histórico manual desaparece com ela). Só exclui
  // o manual de um mês em que a Pluggy JÁ estava rodando pra aquele broker.
  const pluggyStartYmByBroker = new Map<string, number>();
  for (const s of all) {
    if (!s.securityId.startsWith("pluggy:")) continue;
    const symd = yearMonth(s.year, s.month);
    const current = pluggyStartYmByBroker.get(s.brokerId);
    if (current === undefined || symd < current) pluggyStartYmByBroker.set(s.brokerId, symd);
  }

  const seen = new Set<string>();
  const result: Snap[] = [];
  for (const s of all) {
    const symd = yearMonth(s.year, s.month);
    if (symd > cutoffYm) continue;

    if (s.securityId.startsWith("MANUAL:")) {
      const pluggyStart = pluggyStartYmByBroker.get(s.brokerId);
      if (pluggyStart !== undefined && cutoffYm >= pluggyStart) continue;
    }

    const key = `${s.brokerId}:${s.securityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cutoffYm - symd <= ACTIVE_WINDOW_MONTHS) result.push(s);
  }
  return result;
}
