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

export const api = {
  health: () => request<{ status: string; time: string }>('/health'),
  transactions: (params?: { month?: number; year?: number }) => {
    const query = params?.month && params?.year ? `?month=${params.month}&year=${params.year}` : ''
    return request<Transaction[]>(`/transactions${query}`)
  },
  categories: () => request<Category[]>('/categories'),
}
