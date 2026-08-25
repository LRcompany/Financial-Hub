const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    throw new Error(`Falha na requisição: ${path} (${response.status})`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json() as Promise<T>
}

export interface Category {
  id: string
  name: string
  type: 'income' | 'expense'
  essential: boolean
  usage: 'personal' | 'business' | null
  children?: Category[]
}

export interface Transaction {
  id: string
  date: string
  type: 'income' | 'expense'
  description: string
  amount: number
  isTransfer: boolean
  category: Category | null
}

export interface BudgetCategory {
  categoryId: string
  name: string
  planned: number
  spent: number
  previousSpent: number
}

export interface BudgetSummary {
  month: number
  year: number
  dailyGoal: number | null
  todaySpent: number
  monthlyAvgDailySpend: number
  previousMonthlyAvgDailySpend: number
  last14Days: { date: string; amount: number; goal: number | null }[]
  totalPlanned: number
  totalSpent: number
  categories: BudgetCategory[]
}

export interface WealthGoal {
  id: string
  targetAmount: number
}

export interface WealthGoalYearly {
  id: string
  year: number
  savingsTarget: number
  annualReturnAssumptionPct: number
}

export interface YearBreakdown {
  year: number
  startBalance: number
  contribution: number
  endBalance: number
  extrapolated: boolean
}

export interface Projection {
  monthsToGoal: number
  projectedDate: string
  usedExtrapolation: boolean
}

export interface WealthOverview {
  hasData: boolean
  total?: number
  previousTotal?: number
  allocation: { label: string; value: number }[]
  evolution: { label: string; value: number }[]
  investedThisMonth?: number
  investedLastMonth?: number | null
  projectedDividends?: number | null
  projectedDividendsLastMonth?: number | null
  movers: { ticker: string; changePct: number }[]
  wealthGoal: WealthGoal | null
  wealthGoalYearly: WealthGoalYearly[]
  projection: Projection | null
  yearlyBreakdown: YearBreakdown[]
}

export interface ProjectsSummary {
  receivedThisMonth: number
  receivedLastMonth: number
  receivedThisYear: number
  avgMonthly12m: number
  taxPaidThisYear: number
  outstanding: number
  outstandingLastMonth: number
  monthlyReceived: { label: string; value: number }[]
  clientRevenue: { label: string; value: number }[]
  activeProjects: {
    id: string
    name: string
    client: string
    status: string
    contractValue: number
    received: number
  }[]
}

export interface DailyGoalEntry {
  id: string
  amount: number
  effectiveFrom: string
}

export interface Position {
  broker: string
  name: string
  ticker: string | null
  investedAmount: number
  marketValue: number
  currency: string
  month: number
  year: number
  quantity: number | null
  unitValue: number | null
  isin: string | null
  issuer: string | null
  dueDate: string | null
  fixedAnnualRate: number | null
  ratePeriodicity: string | null
}

export interface PositionsByType {
  type: string
  isBroker: boolean
  total: number
  positions: Position[]
}

export interface Broker {
  id: string
  name: string
  scope: string
  dataSource: string
  pluggyConnectorId: string | null
  onchainAddress: string | null
  lastSyncedAt: string | null
}

export const api = {
  health: () => request<{ status: string; time: string }>('/health'),
  brokers: () => request<Broker[]>('/brokers'),
  syncBroker: (id: string) => request<{ synced: true; count: number }>(`/brokers/${id}/sync`, { method: 'POST' }),
  pluggyConnectToken: (itemId?: string) =>
    request<{ accessToken: string }>('/pluggy/connect-token', {
      method: 'POST',
      body: JSON.stringify(itemId ? { itemId } : {}),
    }),
  linkPluggyBroker: (itemId: string, connectorName: string) =>
    request<Broker>('/pluggy/link-broker', {
      method: 'POST',
      body: JSON.stringify({ itemId, connectorName }),
    }),
  transactions: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<Transaction[]>(`/transactions${query}`)
  },
  categories: () => request<Category[]>('/categories'),
  budgetSummary: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<BudgetSummary>(`/budget-summary${query}`)
  },
  wealthOverview: () => request<WealthOverview>('/wealth-overview'),
  wealthGoal: () => request<{ targetAmount: number | null; yearly: WealthGoalYearly[] }>('/wealth-goal'),
  setWealthGoalTarget: (targetAmount: number) =>
    request<WealthGoal>('/wealth-goal', { method: 'PUT', body: JSON.stringify({ targetAmount }) }),
  setWealthGoalYearly: (year: number, savingsTarget: number, annualReturnAssumptionPct: number) =>
    request<WealthGoalYearly>(`/wealth-goal/yearly/${year}`, {
      method: 'PUT',
      body: JSON.stringify({ savingsTarget, annualReturnAssumptionPct }),
    }),
  deleteWealthGoalYearly: (year: number) => request<void>(`/wealth-goal/yearly/${year}`, { method: 'DELETE' }),
  dailyGoalHistory: () => request<DailyGoalEntry[]>('/daily-goal/history'),
  setDailyGoal: (amount: number) => request<DailyGoalEntry>('/daily-goal', { method: 'POST', body: JSON.stringify({ amount }) }),
  deleteDailyGoal: (id: string) => request<void>(`/daily-goal/${id}`, { method: 'DELETE' }),
  projectsSummary: (params?: { year?: number }) => {
    const query = params?.year ? `?year=${params.year}` : ''
    return request<ProjectsSummary>(`/projects-summary${query}`)
  },
  positions: () => request<{ hasData: boolean; byType: PositionsByType[] }>('/positions'),
  positionsHistory: (broker: string) =>
    request<{ history: { label: string; value: number }[] }>(`/positions/history?broker=${encodeURIComponent(broker)}`),
  addPosition: (input: {
    brokerName: string
    securityName: string
    type: string
    currency: string
    investedAmount: number
    marketValue: number
    ticker?: string
  }) => request('/positions', { method: 'POST', body: JSON.stringify(input) }),
}
