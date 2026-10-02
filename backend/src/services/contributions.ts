// Aporte/resgate lançado à mão (05/09) — ver comentário do model Contribution
// no schema.prisma pra motivação. Esse arquivo tem a única lógica que soma um
// aporte no investedAmount "travado" de uma posição: qualquer outro lugar que
// precisar disso deve chamar `applyContribution`, nunca reescrever a conta —
// foi exatamente ter essa lógica duplicada (câmbio recotando o principal
// inteiro em vez de só o delta) que causou o bug da Nomad.
import { prisma } from "../prisma.js";
import { getUsdToBrlRate, getUsdToBrlRateOnDate } from "./fx.js";

const yearMonth = (y: number, m: number) => y * 12 + m;

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export interface ApplyContributionInput {
  brokerId: string;
  securityId: string;
  date: Date;
  amount: number; // moeda original
  currency: string; // "BRL" | "USD"
  note?: string | null;
}

/**
 * Registra um aporte/resgate: grava o Contribution (auditoria) e soma o valor
 * (já convertido pra BRL, na cotação do dia do aporte — nunca a de hoje pra
 * aporte retroativo) no investedAmount do PositionSnapshot do mês do aporte
 * E de todo mês posterior já existente (o investido é cumulativo — um aporte
 * em julho tem que aparecer em agosto/setembro também, senão o "Investido por
 * mês" ia mostrar um resgate falso no mês seguinte). Cria o snapshot do mês
 * do aporte se ainda não existir (ativo/corretora novo).
 */
export async function applyContribution(input: ApplyContributionInput) {
  if (input.currency !== "BRL" && input.currency !== "USD") {
    throw new Error(`Moeda "${input.currency}" ainda não suportada (só BRL/USD).`);
  }

  let fxRateToBRL: number | null = null;
  let amountBRL = input.amount;
  if (input.currency === "USD") {
    fxRateToBRL = isToday(input.date) ? await getUsdToBrlRate() : await getUsdToBrlRateOnDate(input.date.toISOString().slice(0, 10));
    amountBRL = input.amount * fxRateToBRL;
  }

  const month = input.date.getMonth() + 1;
  const year = input.date.getFullYear();
  const targetYm = yearMonth(year, month);

  const contribution = await prisma.contribution.create({
    data: {
      brokerId: input.brokerId,
      securityId: input.securityId,
      date: input.date,
      amount: input.amount,
      currency: input.currency,
      amountBRL,
      fxRateToBRL,
      note: input.note ?? null,
    },
  });

  await applyDeltaToSnapshots(input.brokerId, input.securityId, targetYm, amountBRL, fxRateToBRL);

  return contribution;
}

/** Desfaz um Contribution já lançado (aplica o delta invertido nos mesmos
 * meses) e apaga o registro. Só existe pra corrigir lançamento errado — não
 * tem "editar", apaga e lança de novo. */
export async function revertContribution(contributionId: string) {
  const c = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } });
  const targetYm = yearMonth(c.date.getFullYear(), c.date.getMonth() + 1);
  await applyDeltaToSnapshots(c.brokerId, c.securityId, targetYm, -c.amountBRL, null);
  await prisma.contribution.delete({ where: { id: contributionId } });
}

async function applyDeltaToSnapshots(brokerId: string, securityId: string, targetYm: number, amountBRL: number, fxRateForNewRow: number | null) {
  const all = await prisma.positionSnapshot.findMany({
    where: { brokerId, securityId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const targetRow = all.find((s) => yearMonth(s.year, s.month) === targetYm);
  const baseline = all.find((s) => yearMonth(s.year, s.month) < targetYm); // all já vem desc, primeiro < target é o mais recente anterior

  if (targetRow) {
    await prisma.positionSnapshot.update({
      where: { id: targetRow.id },
      data: { investedAmount: targetRow.investedAmount + amountBRL },
    });
  } else {
    const year = Math.floor((targetYm - 1) / 12);
    const month = targetYm - year * 12;
    const baselineInvested = baseline?.investedAmount ?? 0;
    await prisma.positionSnapshot.create({
      data: {
        brokerId,
        securityId,
        month,
        year,
        investedAmount: baselineInvested + amountBRL,
        // Ativo novo, sem sync automático ainda — melhor aproximação de
        // marketValue é o próprio custo (0% de rentabilidade até o próximo
        // sync/atualização trazer o valor de mercado real).
        marketValue: baseline?.marketValue ?? baselineInvested + amountBRL,
        fxRateToBRL: baseline?.fxRateToBRL ?? fxRateForNewRow,
      },
    });
  }

  // Cascata: todo mês DEPOIS do mês do aporte já existente também carrega
  // esse dinheiro no investido (é cumulativo) — sem isso, um aporte lançado
  // retroativo (aporte de julho lançado em setembro) faria agosto/setembro
  // parecerem ter tido um resgate do mesmo valor.
  const laterRows = all.filter((s) => yearMonth(s.year, s.month) > targetYm);
  for (const row of laterRows) {
    await prisma.positionSnapshot.update({
      where: { id: row.id },
      data: { investedAmount: row.investedAmount + amountBRL },
    });
  }
}
