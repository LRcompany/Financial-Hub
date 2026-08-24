// Projeção do "1º milhão" — espelha a lógica da aba "Primeira Milha(o)" da
// planilha (meta de aporte por ano), mas com juro composto mês a mês em vez
// de juro simples — é estritamente mais preciso pro mesmo objetivo.

export interface YearlyGoal {
  year: number;
  savingsTarget: number; // quanto planeja guardar/aportar no ano inteiro
  annualReturnAssumptionPct: number;
}

export interface YearBreakdown {
  year: number;
  startBalance: number;
  contribution: number;
  endBalance: number;
  /** true = esse ano não tinha meta configurada, usamos a do último ano configurado */
  extrapolated: boolean;
}

export interface Projection {
  monthsToGoal: number;
  projectedDate: string;
  usedExtrapolation: boolean;
}

const MAX_MONTHS = 600; // 50 anos — teto de segurança contra loop infinito

export function projectFirstMillion(
  currentTotal: number,
  targetAmount: number | null,
  yearlyGoals: YearlyGoal[]
): { projection: Projection | null; yearlyBreakdown: YearBreakdown[] } {
  if (!targetAmount || yearlyGoals.length === 0) {
    return { projection: null, yearlyBreakdown: [] };
  }

  const sorted = [...yearlyGoals].sort((a, b) => a.year - b.year);
  const configuredYears = new Set(sorted.map((g) => g.year));
  const lastConfigured = sorted[sorted.length - 1];

  const now = new Date();
  if (currentTotal >= targetAmount) {
    return { projection: { monthsToGoal: 0, projectedDate: now.toISOString(), usedExtrapolation: false }, yearlyBreakdown: [] };
  }

  let balance = currentTotal;
  let month = now.getMonth();
  let year = now.getFullYear();
  let monthsElapsed = 0;
  let usedExtrapolation = false;

  const breakdown: YearBreakdown[] = [];
  let yearStartBalance = balance;
  let yearContribution = 0;
  let curYear = year;

  while (balance < targetAmount && monthsElapsed < MAX_MONTHS) {
    const row = configuredYears.has(year) ? sorted.find((g) => g.year === year)! : lastConfigured;
    const extrapolatedThisMonth = !configuredYears.has(year);
    if (extrapolatedThisMonth) usedExtrapolation = true;

    const monthlyRate = Math.pow(1 + row.annualReturnAssumptionPct / 100, 1 / 12) - 1;
    const monthlyContribution = row.savingsTarget / 12;
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    yearContribution += monthlyContribution;
    monthsElapsed++;
    month++;

    if (month > 11) {
      breakdown.push({
        year: curYear,
        startBalance: yearStartBalance,
        contribution: yearContribution,
        endBalance: balance,
        extrapolated: !configuredYears.has(curYear),
      });
      month = 0;
      year++;
      curYear = year;
      yearStartBalance = balance;
      yearContribution = 0;
    }
  }

  if (yearContribution > 0) {
    breakdown.push({
      year: curYear,
      startBalance: yearStartBalance,
      contribution: yearContribution,
      endBalance: balance,
      extrapolated: !configuredYears.has(curYear),
    });
  }

  if (monthsElapsed >= MAX_MONTHS) {
    return { projection: null, yearlyBreakdown: breakdown };
  }

  const projectedDate = new Date(now);
  projectedDate.setMonth(projectedDate.getMonth() + monthsElapsed);

  return {
    projection: { monthsToGoal: monthsElapsed, projectedDate: projectedDate.toISOString(), usedExtrapolation },
    yearlyBreakdown: breakdown,
  };
}
