import { prisma } from "../prisma.js";

export async function fetchAllSnapshots() {
  // Corretora arquivada some do Patrimônio/wealth overview (é o que "arquivar"
  // quer dizer — não conta mais no total), mas o PositionSnapshot em si nunca
  // é apagado: desarquivar traz o histórico de volta inteiro.
  return prisma.positionSnapshot.findMany({
    where: { broker: { archivedAt: null } },
    include: { security: true, broker: true },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export type Snap = Awaited<ReturnType<typeof fetchAllSnapshots>>[number];

const ACTIVE_WINDOW_MONTHS = 2; // sem snapshot há mais de 2 meses = corretora encerrada, não conta mais
export const yearMonth = (y: number, m: number) => y * 12 + m;

/**
 * "Esse broker+tipo já tinha dado automático nesse ponto do tempo?" — não
 * pode ser uma checagem global (senão exclui a fonte automática do passado
 * inteiro, antes dela sequer existir, e o histórico manual desaparece com
 * ela). Cada chave `brokerId:security.type` guarda o PRIMEIRO ym em que
 * apareceu um snapshot `pluggy:*`/`onchain:*` daquele broker+tipo — usado
 * tanto por `activeSnapshotsAsOf` (esconder o manual redundante) quanto por
 * `wealth.ts` (não contar a transição em si como "aporte", ver "Aportado
 * real" no changelog). Extraído em função própria (14/09) pra não duplicar
 * essa conta nos dois lugares.
 */
export function automatedStartYmByBrokerType(all: Snap[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of all) {
    if (!s.securityId.startsWith("pluggy:") && !s.securityId.startsWith("onchain:")) continue;
    const key = `${s.brokerId}:${s.security.type}`;
    const symd = yearMonth(s.year, s.month);
    const current = map.get(key);
    if (current === undefined || symd < current) map.set(key, symd);
  }
  return map;
}

/**
 * "O que eu tinha em carteira, na visão de cutoffYm" — snapshot mais recente
 * de cada (broker, security) que já existia até aquele ponto, contando só se
 * ainda estava "vivo" (dentro da janela de atividade).
 *
 * Regra extra pra broker que migrou de planilha manual pra fonte automática
 * (Pluggy — BTG, C6, 99, Sofisa — ou consulta on-chain — Phantom): uma vez
 * que existe QUALQUER snapshot `pluggy:*`/`onchain:*` pra aquele broker
 * NAQUELA CLASSE DE ATIVO (`security.type`), os Security antigos `MANUAL:*`
 * do MESMO broker E MESMO TIPO somem — senão o mesmo dinheiro conta duas
 * vezes (a linha manual estimada e o dado automático são o mesmo saldo, não
 * dois).
 *
 * Bug real (14/09, achado investigando por que um aporte no Tesouro Selic
 * do BTG não aparecia): a checagem original era só por `brokerId`, sem olhar
 * o tipo. BTG migrou Ação/FII pra sync automático por ativo em ago/2026, mas
 * a Renda Fixa (Tesouro Direto) NUNCA migrou — continua 100% manual
 * (`MANUAL:BTG:TESOURO SELIC`, criada pelo modal "Registrar aporte"). Como a
 * checagem só olhava "esse broker tem QUALQUER snapshot automático", a
 * chegada do sync automático de Ação/FII em ago/2026 apagou da visão TODA
 * Renda Fixa manual do BTG a partir daquele mês — R$47mil+ que continuavam
 * lá de verdade, só que sem fonte automática pra confirmar, sumiram do
 * Patrimônio/wealth overview inteiros (não só desse ativo — a mesma função
 * alimenta a tabela de posições E os totais de patrimônio). Escopar por
 * `brokerId + security.type` corrige: só exclui o manual de um TIPO que
 * realmente ganhou fonte automática pra aquele broker, nunca um tipo
 * diferente que continua 100% manual.
 */
export function activeSnapshotsAsOf(all: Snap[], cutoffYm: number): Snap[] {
  const automatedStartYm = automatedStartYmByBrokerType(all);

  const seen = new Set<string>();
  const result: Snap[] = [];
  for (const s of all) {
    const symd = yearMonth(s.year, s.month);
    if (symd > cutoffYm) continue;

    if (s.securityId.startsWith("MANUAL:")) {
      const automatedStart = automatedStartYm.get(`${s.brokerId}:${s.security.type}`);
      if (automatedStart !== undefined && cutoffYm >= automatedStart) continue;
    }

    const key = `${s.brokerId}:${s.securityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cutoffYm - symd <= ACTIVE_WINDOW_MONTHS) result.push(s);
  }
  return result;
}
