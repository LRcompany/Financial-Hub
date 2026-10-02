import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { api, type DividendPayment } from '../lib/api'
import { currency } from '../lib/format'
import { Input } from './Input'
import { IconButton } from './IconButton'
import { Money } from './Money'
import { ModalShell } from './ModalShell'
import styles from './ManualDividendModal.module.css'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

/** Lançamento manual de provento (11/09) — pedido do Luiz pro fundo VALORA:
 * "a Pluggy não me manda o rendimento desse fundo, quero lançar eu mesmo,
 * com a data e o valor, desde a criação do fundo". Grava direto na mesma
 * `DividendPayment` que a Pluggy usa pra Ação/FII — por isso não precisa de
 * nenhum código extra pra aparecer na coluna "Proventos (mês)" nem no
 * card/gráfico agregado "Proventos recebidos", os dois já leem dessa
 * tabela. Reenviar a mesma data (mesmo mês/ano) SUBSTITUI o valor — é assim
 * que se corrige um lançamento errado, sem precisar apagar antes. */
export function ManualDividendModal({
  brokerId,
  securityId,
  securityName,
  onClose,
  onSaved,
}: {
  brokerId: string
  securityId: string
  securityName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [payments, setPayments] = useState<DividendPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')

  function load() {
    api
      .dividendPayments(brokerId, securityId)
      .then((r) => setPayments(r.payments))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [brokerId, securityId])

  async function handleAdd() {
    setError(null)
    const parsed = Number(amount)
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setError('Digite um valor maior que zero.')
      return
    }
    if (!date) {
      setError('Escolha a data do recebimento.')
      return
    }
    setSaving(true)
    try {
      await api.addDividendPayment({ brokerId, securityId, date, amount: parsed })
      setAmount('')
      load()
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await api.deleteDividendPayment(id)
      load()
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <ModalShell
      title={`Rendimentos — ${securityName}`}
      subtitle={'A Pluggy não manda provento pra esse tipo de ativo — lance aqui, com a data e o valor, e ele aparece na coluna "Proventos (mês)" e no total do ano.'}
      onClose={onClose}
    >
      <div className={styles.formRow}>
        <Input label="Data do recebimento" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Valor (R$)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button className={styles.saveBtn} onClick={handleAdd} disabled={saving}>
          {saving ? 'Adicionando...' : '+ Adicionar'}
        </button>
      </div>

      <div className={styles.list}>
        {loading && <p className={styles.helperText}>Carregando...</p>}
        {!loading && payments.length === 0 && <p className={styles.helperText}>Nenhum rendimento lançado ainda.</p>}
        {payments.map((p) => (
          <div key={p.id} className={styles.row}>
            <span className={styles.rowLabel}>{monthLabel(p.month, p.year)}</span>
            <span className={styles.rowValue}>
              <Money>R$ {currency(p.amount)}</Money>
            </span>
            <IconButton
              size="sm"
              variant="danger"
              aria-label="Remover lançamento"
              onClick={() => handleDelete(p.id)}
              disabled={deletingId === p.id}
            >
              <Trash2 size={13} strokeWidth={2} />
            </IconButton>
          </div>
        ))}
      </div>
    </ModalShell>
  )
}
