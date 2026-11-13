// Projeção do "1º milhão" (01/09, reescrita) — antes exigia o Luiz digitar,
// ano a ano, um "retorno assumido" (chute) e um "aporte no ano". Ele pediu
// pra ficar "mais dinâmico e no cenário real": usar a rentabilidade REAL dos
// investimentos que ele já tem (não um chute) + um único valor de aporte
// mensal (não uma tabela por ano) — simples de olhar e de entender de onde
// vem o número.

export interface MonthlyTotal {
  marketValue: number;
  investedAmount: number;
}

/** Retorno médio mensal REAL, isolando valorização de mercado do dinheiro
 * novo que entrou. Comparar só `marketValue` mês a mês contaria um aporte
 * novo como se fosse rentabilidade (ex: colocar R$5.000 a mais faria parecer
 * que o patrimônio "rendeu" 5.000) — por isso o cálculo tira a variação de
 * `investedAmount` (custo de aquisição, sobe quando entra dinheiro novo) do
 * meio: o que sobra é rentabilidade de verdade. Precisa de pelo menos 2
 * meses de histórico; menos que isso, não tem base pra calcular nada (não
 * inventa uma taxa). */
export function computeAverageMonthlyReturnPct(monthlyTotals: MonthlyTotal[]): number | null {
  if (monthlyTotals.length < 2) return null;
  const monthlyReturns: number[] = [];
  for (let i = 1; i < monthlyTotals.length; i++) {
    const prev = monthlyTotals[i - 1];
    const cur = monthlyTotals[i];
    if (prev.marketValue <= 0) continue;
    const newContribution = cur.investedAmount - prev.investedAmount;
    const pureGrowth = cur.marketValue - prev.marketValue - newContribution;
    monthlyReturns.push(pureGrowth / prev.marketValue);
  }
  if (monthlyReturns.length === 0) return null;
  const avg = monthlyReturns.reduce((sum, r) => sum + r, 0) / monthlyReturns.length;
  return avg * 100;
}

export interface YearBreakdown {
  year: number;
  startBalance: number;
  // Aporte planejado do ANO (10/11, Luiz: "esse valor é anual"): meses do
  // plano naquele ano × aporte mensal. Ano corrente = de set/2026 (início do
  // Command OS) ou janeiro até dezembro — não encolhe a cada mês que passa.
  // Último ano da projeção = só até o mês em que bate a meta.
  contribution: number;
  fromMonth: number; // 1–12, primeiro mês do plano nesse ano
  toMonth: number; // 1–12, último mês do plano nesse ano
  endBalance: number;
  // Quanto REALMENTE entrou de aporte novo nesse ano até agora — só
  // preenchido na linha do ano CORRENTE (nas linhas futuras não existe "real"
  // ainda, ficam null). Pedido do Luiz (04/09): comparar o planejado
  // (`contribution`) com o que ele de fato conseguiu aportar.
  realContribution: number | null;
  // Planejado do início do plano no ano até o mês consultado — a base de
  // comparação do `realContribution` (mesmo período). Só no ano corrente.
  plannedSoFar: number | null;
}

/** O plano do primeiro milhão vale desde set/2026, quando o Command OS
 * passou a valer (10/11: "se a gente começou em setembro o aporte deveria
 * ser de setembro"). */
export const PLAN_START = { year: 2026, month: 9 };
export const planStartMonthOf = (year: number) => (year === PLAN_START.year ? PLAN_START.month : 1);

export interface Projection {
  monthsToGoal: number;
  projectedDate: string;
}

const MAX_MONTHS = 600; // 50 anos — teto de segurança contra loop infinito/taxa negativa

/** Juro composto mês a mês com UMA taxa só (a média real calculada acima) +
 * UM aporte mensal fixo — bem mais simples que a versão anterior (taxa e
 * aporte variando ano a ano, configurados na mão). */
export function projectFirstMillion(
  currentTotal: number,
  targetAmount: number | null,
  monthlyContribution: number,
  avgMonthlyReturnPct: number | null,
  // Aportado REAL no ano corrente, do início do plano até o mês consultado
  // (`throughMonth`, 1–12) — calculado em wealth.ts a partir do histórico de
  // PositionSnapshot. Só entra na linha do ano corrente (pedido do Luiz, 04/09).
  currentYear: { real: number; throughMonth: number } | null = null
): { projection: Projection | null; yearlyBreakdown: YearBreakdown[] } {
  if (!targetAmount) {
    return { projection: null, yearlyBreakdown: [] };
  }

  const now = new Date();
  const currentCalendarYear = now.getFullYear();
  if (currentTotal >= targetAmount) {
    return { projection: { monthsToGoal: 0, projectedDate: now.toISOString() }, yearlyBreakdown: [] };
  }

  const monthlyRate = (avgMonthlyReturnPct ?? 0) / 100;
  let balance = currentTotal;
  let month = now.getMonth();
  let year = now.getFullYear();
  let monthsElapsed = 0;

  const breakdown: YearBreakdown[] = [];
  let yearStartBalance = balance;
  let yearContribution = 0;
  let curYear = year;

  // A projeção em si parte do saldo de HOJE (o que já foi aportado no ano já
  // está nele); só o que a linha MOSTRA de aporte do ano corrente é o plano
  // do ano inteiro.
  const pushRow = (toMonth: number) => {
    const isCurrent = curYear === currentCalendarYear;
    const fromMonth = isCurrent ? planStartMonthOf(curYear) : 1;
    breakdown.push({
      year: curYear,
      startBalance: yearStartBalance,
      contribution: isCurrent ? monthlyContribution * (toMonth - fromMonth + 1) : yearContribution,
      fromMonth,
      toMonth,
      endBalance: balance,
      realContribution: isCurrent && currentYear ? currentYear.real : null,
      plannedSoFar: isCurrent && currentYear ? monthlyContribution * Math.max(0, currentYear.throughMonth - fromMonth + 1) : null,
    });
  };

  while (balance < targetAmount && monthsElapsed < MAX_MONTHS) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    yearContribution += monthlyContribution;
    monthsElapsed++;
    month++;

    if (month > 11) {
      pushRow(12);
      month = 0;
      year++;
      curYear = year;
      yearStartBalance = balance;
      yearContribution = 0;
    }
  }

  if (yearContribution > 0) pushRow(month);

  if (monthsElapsed >= MAX_MONTHS) {
    return { projection: null, yearlyBreakdown: breakdown };
  }

  const projectedDate = new Date(now);
  projectedDate.setMonth(projectedDate.getMonth() + monthsElapsed);

  return {
    projection: { monthsToGoal: monthsElapsed, projectedDate: projectedDate.toISOString() },
    yearlyBreakdown: breakdown,
  };
}
