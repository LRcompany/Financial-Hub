// Meta diária de gasto (20/11) — ver docs/blueprint.md.
//
// Luiz: "Cada categoria ganha uma marcação 'conta para a meta diária'.
// Aluguel, contas e usina ficam de fora." e "livre hoje = (meta diária × dias
// do mês − gasto variável até ontem − parcelas variáveis que ainda vão cair no
// mês) ÷ dias que faltam, contando hoje". A parcela entra pela categoria da
// compra e fica diluída pelos dias do mês — não pesa só no dia em que cai.

export type DailyItem = {
  day: number; // dia do mês (1–31), calendário brasileiro
  amount: number;
  isInstallment: boolean; // parcela de compra parcelada (lançada ou prevista)
  counts: boolean; // categoria conta pra meta diária
};

/** Categoria conta pra meta diária se ela E todas as mães contam. Sem categoria conta. */
export function countsForDailyGoal(
  categoryId: string | null,
  byId: Map<string, { countsForDailyGoal: boolean; parentId: string | null }>
): boolean {
  let id = categoryId;
  for (let guard = 0; id && guard < 5; guard++) {
    const c = byId.get(id);
    if (!c) return true;
    if (!c.countsForDailyGoal) return false;
    id = c.parentId;
  }
  return true;
}

/** Parcelas variáveis do mês inteiro, diluídas por dia. */
export function installmentShare(items: DailyItem[], daysInMonth: number): number {
  const total = items.filter((i) => i.counts && i.isInstallment).reduce((s, i) => s + i.amount, 0);
  return daysInMonth > 0 ? total / daysInMonth : 0;
}

/** O que pesa na meta num dia: gasto variável do dia (sem parcela) + a fatia diluída das parcelas. */
export function goalSpendOfDay(items: DailyItem[], day: number, share: number): number {
  return items.filter((i) => i.counts && !i.isInstallment && i.day === day).reduce((s, i) => s + i.amount, 0) + share;
}

/** Livre pra gastar hoje. Negativo = já passou (a tela mostra "passou R$ X"). */
export function freeToSpendToday(goal: number, daysInMonth: number, today: number, items: DailyItem[]): number {
  const spentUntilYesterday = items.filter((i) => i.counts && !i.isInstallment && i.day < today).reduce((s, i) => s + i.amount, 0);
  const installments = items.filter((i) => i.counts && i.isInstallment).reduce((s, i) => s + i.amount, 0);
  const daysLeft = daysInMonth - today + 1;
  return (goal * daysInMonth - spentUntilYesterday - installments) / daysLeft;
}
