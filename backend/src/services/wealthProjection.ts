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
  contribution: number;
  endBalance: number;
}

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
  avgMonthlyReturnPct: number | null
): { projection: Projection | null; yearlyBreakdown: YearBreakdown[] } {
  if (!targetAmount) {
    return { projection: null, yearlyBreakdown: [] };
  }

  const now = new Date();
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

  while (balance < targetAmount && monthsElapsed < MAX_MONTHS) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    yearContribution += monthlyContribution;
    monthsElapsed++;
    month++;

    if (month > 11) {
      breakdown.push({ year: curYear, startBalance: yearStartBalance, contribution: yearContribution, endBalance: balance });
      month = 0;
      year++;
      curYear = year;
      yearStartBalance = balance;
      yearContribution = 0;
    }
  }

  if (yearContribution > 0) {
    breakdown.push({ year: curYear, startBalance: yearStartBalance, contribution: yearContribution, endBalance: balance });
  }

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
