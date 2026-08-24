const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    throw new Error(`Falha na requisição: ${path} (${response.status})`)
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
  last14Days: { date: string; amount: number }[]
  totalPlanned: number
  totalSpent: number
  categories: BudgetCategory[]
}

export interface WealthGoal {
  id: string
  monthlySavingsTarget: number
  annualReturnAssumptionPct: number
  targetAmount: number
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
  projection: { monthsToGoal: number; projectedDate: string } | null
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
  projectsSummary: (params?: { year?: number }) => {
    const query = params?.year ? `?year=${params.year}` : ''
    return request<ProjectsSummary>(`/projects-summary${query}`)
  },
}
