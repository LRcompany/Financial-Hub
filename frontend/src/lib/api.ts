import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // manda o cookie de sessão — sem isso toda rota autenticada vira 401
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
  totalIncome: number
  previousTotalIncome: number
  incomeFromProjects: number
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
  estimated: boolean
}

export interface UpcomingInstallment {
  id: string
  dueDate: string
  description: string
  note: string | null
  amount: number
  category: string | null
  cardLabel: string | null
  // "parcela 6 de 10" — null pra parcela importada da planilha (sem esse
  // detalhe de origem), sempre presente pra parcela vinda do sync da Pluggy.
  installmentNumber: number | null
  totalInstallments: number | null
}

export interface UpcomingInstallmentsSummary {
  total: number
  byCard: { card: string; amount: number }[]
  byMonth: { month: number; year: number; amount: number }[]
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
  // Total de parcelas da compra — automático (derivado) ou corrigido à mão
  // na modal "Revisar parcelas". Null quando não dá pra saber (parcela de
  // planilha sem correção manual ainda).
  totalInstallments: number | null
  ids: string[]
}

export interface LeafCategoryOption {
  id: string
  path: string
}

export interface WealthGoal {
  id: string
  targetAmount: number
  monthlyContribution: number
}

export interface YearBreakdown {
  year: number
  startBalance: number
  contribution: number
  endBalance: number
}

export interface Projection {
  monthsToGoal: number
  projectedDate: string
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
  movers: { category: string; changePct: number }[]
  wealthGoal: WealthGoal | null
  /** Retorno médio mensal REAL (%), calculado do histórico de PositionSnapshot
   * — null quando não tem pelo menos 2 meses de dado pra calcular. */
  avgMonthlyReturnPct: number | null
  projection: Projection | null
  yearlyBreakdown: YearBreakdown[]
}

export interface ProjectsSummary {
  grossRevenue: number
  netRevenue: number
  taxEstimatedTotal: number
  taxPaidTotal: number
  hasEstimatedTax: boolean
  receivedThisMonth: number
  receivedLastMonth: number
  receivedThisYear: number
  avgMonthly12m: number
  taxPaidThisYear: number
  outstanding: number
  outstandingLastMonth: number
  supplierPaid: number
  supplierOutstanding: number
  totalDaysWorked: number
  finalizedCount: number
  openCount: number
  monthlyReceived: { label: string; value: number }[]
  clientRevenue: { label: string; value: number }[]
  clientContractValue: { label: string; value: number }[]
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

export interface Client {
  id: string
  name: string
  isForeign: boolean
}

export interface Supplier {
  id: string
  name: string
}

export interface ProjectSupplierCostSummary {
  id: string
  supplierId: string
  supplierName: string
  agreedAmount: number
  installmentCount: number
  paid: number
}

export interface ProjectListItem {
  id: string
  client: { id: string; name: string; isForeign: boolean }
  name: string
  startDate: string
  endDate: string | null
  contractValue: number
  hasInvoice: boolean
  installmentCount: number
  status: 'em_andamento' | 'pausado' | 'cancelado' | 'finalizado'
  daysTotal: number | null
  received: number
  remaining: number
  supplierCost: number
  supplierPaid: number
  taxAmount: number
  taxEstimated: boolean
  net: number
  yieldPerDay: number | null
  suppliers: ProjectSupplierCostSummary[]
}

export interface ProjectReceipt {
  id: string
  installmentNumber: number
  amount: number
  paymentDate: string
}

export interface SupplierPayment {
  id: string
  installmentNumber: number
  amount: number
  paymentDate: string
}

export interface ProjectDetail {
  id: string
  clientId: string
  client: Client
  name: string
  startDate: string
  endDate: string | null
  contractValue: number
  hasInvoice: boolean
  installmentCount: number
  status: string
  receipts: ProjectReceipt[]
  supplierCosts: {
    id: string
    supplierId: string
    supplier: Supplier
    agreedAmount: number
    installmentCount: number
    payments: SupplierPayment[]
  }[]
}

export interface TaxPayment {
  id: string
  competenceMonth: number
  competenceYear: number
  totalRevenue: number
  amountPaid: number
  paymentDate: string
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

export interface BrokerPosition {
  securityId: string
  name: string
  type: string
  currency: string
  quantity: number | null
  unitValue: number | null
  marketValue: number
  investedAmount: number
  lastUpdated: string
}

export interface PositionFieldConfig {
  currency: 'USD' | 'BRL' | 'selectable'
  showType: boolean
  showQuantity: boolean
  showUnitValue: boolean
  showInvestedAmount: boolean
  fixedType?: string
  excludeSecurityNames?: string[]
}

export interface AuthStatus {
  authenticated: boolean
  hasPinConfigured: boolean
  hasWebauthnCredential: boolean
}

export interface WebauthnCredentialInfo {
  id: string
  deviceLabel: string
  createdAt: string
}

async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `Falha (${response.status})`)
  return data as T
}

const postForAuth = <T>(path: string, body?: unknown) => sendJson<T>('POST', path, body)
const postJson = <T>(path: string, body?: unknown) => sendJson<T>('POST', path, body)
const putJson = <T>(path: string, body?: unknown) => sendJson<T>('PUT', path, body)

export const api = {
  health: () => request<{ status: string; time: string }>('/health'),
  authStatus: () => request<AuthStatus>('/auth/status'),
  authSetup: (pin: string) => postForAuth<{ ok: true }>('/auth/setup', { pin }),
  authLogin: (pin: string) => postForAuth<{ ok: true }>('/auth/login', { pin }),
  authLogout: () => postForAuth<{ ok: true }>('/auth/logout'),
  changePin: async (currentPin: string, newPin: string) => {
    const response = await fetch(`${API_URL}/auth/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPin, newPin }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao trocar a senha (${response.status})`)
    return data as { ok: true }
  },
  webauthnCredentials: () => request<WebauthnCredentialInfo[]>('/auth/webauthn/credentials'),
  deleteWebauthnCredential: (id: string) =>
    request<{ ok: true }>(`/auth/webauthn/${id}`, { method: 'DELETE' }),
  webauthnRegisterOptions: () => postForAuth<PublicKeyCredentialCreationOptionsJSON>('/auth/webauthn/register-options'),
  webauthnRegisterVerify: (response: RegistrationResponseJSON, deviceLabel: string) =>
    postForAuth<{ ok: true }>('/auth/webauthn/register-verify', { response, deviceLabel }),
  webauthnLoginOptions: () => postForAuth<PublicKeyCredentialRequestOptionsJSON>('/auth/webauthn/login-options'),
  webauthnLoginVerify: (response: AuthenticationResponseJSON) =>
    postForAuth<{ ok: true }>('/auth/webauthn/login-verify', { response }),
  brokers: () => request<Broker[]>('/brokers'),
  syncBroker: (id: string) => request<{ synced: true; count: number }>(`/brokers/${id}/sync`, { method: 'POST' }),
  archiveBroker: async (id: string) => {
    const response = await fetch(`${API_URL}/brokers/${id}/archive`, { method: 'POST', credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao arquivar a conexão (${response.status})`)
    return data as Broker
  },
  unarchiveBroker: async (id: string) => {
    const response = await fetch(`${API_URL}/brokers/${id}/unarchive`, { method: 'POST', credentials: 'include' })
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
      credentials: 'include',
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
      credentials: 'include',
      body: JSON.stringify(input),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao atualizar categoria (${response.status})`)
    return data as Category
  },
  deleteCategory: async (id: string) => {
    const response = await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE', credentials: 'include' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao excluir categoria (${response.status})`)
    return data as { deleted: true }
  },
  budgetSummary: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<BudgetSummary>(`/budget-summary${query}`)
  },
  wealthOverview: () => request<WealthOverview>('/wealth-overview'),
  setWealthGoal: (input: { targetAmount?: number; monthlyContribution?: number }) =>
    request<WealthGoal>('/wealth-goal', { method: 'PUT', body: JSON.stringify(input) }),
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
      transactionsReconciled: number
      installmentsCreated: number
      categorizedCount: number
      perBroker: {
        broker: string
        transactionsSynced: number
        transactionsSkipped: number
        transactionsReconciled: number
        installmentsCreated: number
        categorizedCount: number
        error?: string
      }[]
    }>('/credit-cards/sync-transactions', { method: 'POST' }),
  upcomingInstallments: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<UpcomingInstallmentsSummary>(`/upcoming-installments${query}`)
  },
  installmentGroups: () =>
    request<{ groups: InstallmentGroup[]; knownCards: string[]; categories: LeafCategoryOption[] }>('/upcoming-installments/groups'),
  updateInstallmentGroup: (
    ids: string[],
    changes: { cardLabel?: string | null; amount?: number; categoryId?: string | null; note?: string | null; totalInstallments?: number | null }
  ) =>
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
  clients: () => request<Client[]>('/clients'),
  createClient: (input: { name: string; isForeign?: boolean }) => postJson<Client>('/clients', input),
  updateClient: (id: string, input: { name?: string; isForeign?: boolean }) => putJson<Client>(`/clients/${id}`, input),
  suppliers: () => request<Supplier[]>('/suppliers'),
  createSupplier: (name: string) => postJson<Supplier>('/suppliers', { name }),
  projects: () => request<ProjectListItem[]>('/projects'),
  project: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  createProject: (input: {
    clientId: string
    name: string
    startDate: string
    endDate?: string | null
    contractValue: number
    hasInvoice: boolean
    installmentCount?: number
  }) => postJson<{ id: string }>('/projects', input),
  updateProject: (
    id: string,
    input: Partial<{
      name: string
      startDate: string
      endDate: string | null
      contractValue: number
      hasInvoice: boolean
      installmentCount: number
      status: 'em_andamento' | 'pausado' | 'cancelado'
    }>
  ) => putJson<{ id: string }>(`/projects/${id}`, input),
  createProjectReceipt: (input: { projectId: string; installmentNumber?: number; amount: number; paymentDate: string }) =>
    postJson<ProjectReceipt>('/project-receipts', input),
  deleteProjectReceipt: (id: string) => request<{ deleted: true }>(`/project-receipts/${id}`, { method: 'DELETE' }),
  createProjectSupplierCost: (input: { projectId: string; supplierId: string; agreedAmount: number; installmentCount?: number }) =>
    postJson<{ id: string }>('/project-supplier-costs', input),
  createSupplierPayment: (input: { projectSupplierCostId: string; installmentNumber?: number; amount: number; paymentDate: string }) =>
    postJson<SupplierPayment>('/supplier-payments', input),
  taxPayments: () => request<TaxPayment[]>('/tax-payments'),
  taxPaymentPreview: (month: number, year: number) =>
    request<{ totalRevenue: number; alreadyExists: boolean }>(`/tax-payments/preview?month=${month}&year=${year}`),
  createTaxPayment: (input: { competenceMonth: number; competenceYear: number; totalRevenue?: number; amountPaid: number; paymentDate: string }) =>
    postJson<TaxPayment>('/tax-payments', input),
  positions: () => request<{ hasData: boolean; byType: PositionsByType[] }>('/positions'),
  fxRate: () => request<{ usdToBrl: number }>('/fx-rate'),
  brokerPositions: (brokerId: string) =>
    request<{ positions: BrokerPosition[]; brokerLastSyncedAt: string | null; fieldConfig: PositionFieldConfig }>(`/brokers/${brokerId}/positions`),
  updateBrokerPositions: async (
    brokerId: string,
    positions: {
      securityId?: string
      name: string
      type: string
      currency: string
      quantity: number | null
      unitValue: number | null
      marketValue: number
      investedAmount: number | null
    }[]
  ) => {
    const response = await fetch(`${API_URL}/brokers/${brokerId}/positions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ positions }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Falha ao salvar as posições (${response.status})`)
    return data as { saved: true; count: number; month: number; year: number }
  },
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
