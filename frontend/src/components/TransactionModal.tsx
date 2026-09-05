import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type Broker, type LeafCategoryOption } from '../lib/api'
import { Input } from './Input'
import { Select } from './Select'
import styles from './ContributionModal.module.css'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Modal "Lançar gasto manual" (05/09) — pro caso de compra que não vem
 * automático pela Pluggy (ex: Wise, que só é usada como reserva em dólar, sem
 * conexão de transação ligada). Sempre gasto — receita continua vindo de
 * Salário/Projetos, não faz sentido lançar receita avulsa aqui. O campo
 * "banco" é opcional e aceita QUALQUER corretora cadastrada (não precisa ter
 * sync automático) — só marca de onde saiu o dinheiro. */
export function TransactionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<LeafCategoryOption[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [categoryId, setCategoryId] = useState('')
  const [brokerId, setBrokerId] = useState('') // '' = não informado

  useEffect(() => {
    Promise.all([api.transactionLeafCategories(), api.brokers()])
      .then(([c, b]) => {
        setCategories(c)
        setBrokers(b.filter((br) => !br.archivedAt))
        if (c.length > 0) setCategoryId(c[0].id)
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setError(null)
    const parsed = Number(amount)
    if (!description.trim()) {
      setError('Digite uma descrição.')
      return
    }
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setError('Digite um valor maior que zero.')
      return
    }
    setSaving(true)
    try {
      await api.createTransaction({
        date,
        type: 'expense',
        description: description.trim(),
        amount: parsed,
        categoryId: categoryId || undefined,
        brokerId: brokerId || undefined,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Lançar gasto manual</h3>
            <p className={styles.subtitle}>Pra compra que não vem automático (ex: Wise) — sempre gasto.</p>
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {loading ? (
          <p className={styles.helperText}>Carregando...</p>
        ) : (
          <>
            <Input label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Jantar em Lisboa" />

            <div className={styles.formRow}>
              <Input label="Valor (R$)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
              <Input label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <Select label="Categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                </option>
              ))}
            </Select>

            <Select label="Banco/corretora de origem (opcional)" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
              <option value="">Não informado</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
