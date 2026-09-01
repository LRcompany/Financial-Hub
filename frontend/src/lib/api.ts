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
  kind: CategoryKind
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
  broker: { id: string; name: string } | null
}

export interface UncategorizedTransactionGroup {
  description: string
  count: number
  totalAmount: number
  lastDate: string
  ids: string[]
}

export type CategoryKind = 'essential' | 'non_essential' | 'investment'

export interface BudgetCategory {
  categoryId: string
  name: string
  kind: CategoryKind
  parentId: string | null
  parentName: string | null
  planned: number
  spent: number
  previousSpent: number
}

export interface BudgetReviewCategory {
  categoryId: string
  name: string
  path: string
  kind: CategoryKind
  previousSpent: number
  currentTarget: number | null
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

export interface CreditCard {
  broker: string
  name: string
  usedAmount: number
  availableLimit: number | null
  creditLimit: number | null
  minimumPayment: number | null
  dueDate: string | null
  brand: string | null
}

export interface UpcomingInstallment {
  id: string
  dueDate: string
  description: string
  note: string | null
  amount: number
  category: string | null
  cardLabel: string | null
}

export interface UpcomingInstallmentsSummary {
  total: number
  byMonth: { month: string; amount: number }[]
  byCard: { card: string; amount: number }[]
  installments: UpcomingInstallment[]
}

export interface InstallmentGroup {
  description: string
  note: string | null
  amount: number
  cardLabel: string | null
  categoryId: string | null
  categoryPath: string | null
  count: number
  firstDueDate: string
  lastDueDate: string
  ids: string[]
}

export interface LeafCategoryOption {
  id: string
  path: string
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
  bestProjectThisMonth: { name: string; received: number } | null
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
  fxRateToBRL: number | null
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
  archivedAt: string | null
}

export interface ParsedStatementPosition {
  name: string
  cusip: string
  quantity: number
  unitValue: number
  marketValue: number
  type: string
}

export interface ParsedStatement {
  positions: ParsedStatementPosition[]
  fdicBalance: number | null
  totalNetWorth: number | null
  securitiesValuation: number | null
  periodEnd: string | null
  warnings: string[]
}

export const api = {
  health: () => request<{ status: string; time: string }>('/health'),
  brokers: () => request<Broker[]>('/brokers'),
  syncBroker: (id: string) => request<{ synced: true; count: number }>(`/brokers/${id}/sync`, { method: 'POST' }),
  archiveBroker: async (id: string) => {
    const response = await fetch(`${API_URL}/brokers/${id}/archive`, { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao arquivar a conexão (${response.status})`)
    return data as Broker
  },
  unarchiveBroker: async (id: string) => {
    const response = await fetch(`${API_URL}/brokers/${id}/unarchive`, { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao desarquivar a conexão (${response.status})`)
    return data as Broker
  },
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
  uncategorizedTransactionGroups: () =>
    request<{ total: number; groups: UncategorizedTransactionGroup[]; categories: LeafCategoryOption[] }>(
      '/transactions/uncategorized-groups'
    ),
  categorizeTransactionGroup: (ids: string[], categoryId: string) =>
    request<{ updated: number }>('/transactions/group', { method: 'PUT', body: JSON.stringify({ ids, categoryId }) }),
  categories: () => request<Category[]>('/categories'),
  createCategory: async (input: { name: string; type?: 'income' | 'expense'; kind?: CategoryKind; parentId?: string }) => {
    const response = await fetch(`${API_URL}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao criar categoria (${response.status})`)
    return data as Category
  },
  updateCategory: async (id: string, input: { name?: string; kind?: CategoryKind }) => {
    const response = await fetch(`${API_URL}/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao atualizar categoria (${response.status})`)
    return data as Category
  },
  deleteCategory: async (id: string) => {
    const response = await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao excluir categoria (${response.status})`)
    return data as { deleted: true }
  },
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
  budgetReview: (month: number, year: number) =>
    request<{ categories: BudgetReviewCategory[] }>(`/budget-target/review?month=${month}&year=${year}`),
  setBudgetTarget: (categoryId: string, month: number, year: number, plannedAmount: number) =>
    request<{ id: string }>('/budget-target', {
      method: 'PUT',
      body: JSON.stringify({ categoryId, month, year, plannedAmount }),
    }),
  copyBudgetFromPreviousMonth: (month: number, year: number) =>
    request<{ copied: number; skippedExisting: number }>('/budget-target/copy-from-previous-month', {
      method: 'POST',
      body: JSON.stringify({ month, year }),
    }),
  creditCards: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<{ cards: CreditCard[] }>(`/credit-cards${query}`)
  },
  syncCreditCardTransactions: () =>
    request<{
      transactionsSynced: number
      transactionsSkipped: number
      installmentsCreated: number
      categorizedCount: number
      perBroker: { broker: string; transactionsSynced: number; transactionsSkipped: number; installmentsCreated: number; categorizedCount: number; error?: string }[]
    }>('/credit-cards/sync-transactions', { method: 'POST' }),
  upcomingInstallments: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<UpcomingInstallmentsSummary>(`/upcoming-installments${query}`)
  },
  installmentGroups: () =>
    request<{ groups: InstallmentGroup[]; knownCards: string[]; categories: LeafCategoryOption[] }>('/upcoming-installments/groups'),
  updateInstallmentGroup: (ids: string[], changes: { cardLabel?: string | null; amount?: number; categoryId?: string | null; note?: string | null }) =>
    request<{ updated: number }>('/upcoming-installments/group', { method: 'PUT', body: JSON.stringify({ ids, ...changes }) }),
  deleteInstallmentGroup: (ids: string[]) =>
    request<{ deleted: number }>('/upcoming-installments/group', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  setDailyGoal: (amount: number) => request<DailyGoalEntry>('/daily-goal', { method: 'POST', body: JSON.stringify({ amount }) }),
  deleteDailyGoal: (id: string) => request<void>(`/daily-goal/${id}`, { method: 'DELETE' }),
  projectsSummary: (params?: { month?: number; year?: number }) => {
    const parts: string[] = []
    if (params?.month) parts.push(`month=${params.month}`)
    if (params?.year) parts.push(`year=${params.year}`)
    return request<ProjectsSummary>(`/projects-summary${parts.length ? `?${parts.join('&')}` : ''}`)
  },
  positions: () => request<{ hasData: boolean; byType: PositionsByType[] }>('/positions'),
  fxRate: () => request<{ usdToBrl: number }>('/fx-rate'),
  previewStatement: async (brokerId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(`${API_URL}/brokers/${brokerId}/statement-preview`, { method: 'POST', body: form })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao ler o extrato (${response.status})`)
    return data as { parsed: ParsedStatement; month: number; year: number }
  },
  confirmStatement: (
    brokerId: string,
    input: { month: number; year: number; periodEnd: string; positions: ParsedStatementPosition[]; fdicBalance: number | null }
  ) =>
    request<{ saved: true; count: number; month: number; year: number }>(`/brokers/${brokerId}/statement-confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  positionsHistory: (group: string) =>
    request<{ history: { label: string; value: number }[] }>(`/positions/history?group=${encodeURIComponent(group)}`),
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
