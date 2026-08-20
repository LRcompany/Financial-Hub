import { prisma } from "../prisma.js";

/**
 * Gera a próxima ocorrência de uma Recurrence (parcela ou assinatura mensal)
 * como uma nova Transaction, se ainda não foi gerada pra esse mês.
 * Roda diariamente via jobs/dailySync.ts.
 */
export async function generateDueOccurrences() {
  const recurrences = await prisma.recurrence.findMany({
    include: { transactions: { orderBy: { date: "desc" }, take: 1 } },
  });

  for (const recurrence of recurrences) {
    const last = recurrence.transactions[0];
    if (!last) continue; // precisa de pelo menos um lançamento-modelo pra replicar

    const nextDate = new Date(last.date);
    nextDate.setMonth(nextDate.getMonth() + 1);

    if (nextDate > new Date()) continue; // ainda não chegou a hora

    // TODO: checar installments (se number fixo, parar de gerar depois de N)
    // TODO: checar se já não foi gerada (evitar duplicar em re-execução do job)

    await prisma.transaction.create({
      data: {
        date: nextDate,
        type: last.type,
        description: last.description,
        amount: last.amount, // valor pode ser editado depois pelo usuário
        categoryId: last.categoryId,
        recurrenceId: recurrence.id,
        source: "manual",
      },
    });
  }
}
