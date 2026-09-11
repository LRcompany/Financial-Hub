import { useState } from 'react'
import { api, type Transaction, type LeafCategoryOption } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { Input } from './Input'
import { Select } from './Select'
import { InstallmentBadge } from './Badge'
import { ModalShell } from './ModalShell'
import styles from './TransactionEditModal.module.css'

function formatFullDate(iso: string): string {
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** Editar categoria/nota de uma transação (11/09, pedido do Luiz: "a edição
 * tem que rolar através de modal e não diretamente na lista... assim não
 * fica intuitivo que dá pra clicar em nota e editar"). Antes cada linha da
 * lista JÁ vinha com Select/Input abertos direto (Orçamento > "Todas as
 * transações do mês") — clicar na linha abre isso aqui em vez disso, lista
 * fica só leitura. Componente ÚNICO usado em Orçamento e no Dashboard
 * ("Últimas transações") — mesma edição, dois lugares que mostram a mesma
 * lista, nunca duas modais duplicadas pro mesmo conceito. */
export function TransactionEditModal({
  transaction,
  categories,
  onClose,
  onSaved,
}: {
  transaction: Transaction
  categories: LeafCategoryOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const canEditCategory = !transaction.isTransfer && transaction.type !== 'income'
  const [categoryId, setCategoryId] = useState(transaction.category?.id ?? '')
  const [note, setNote] = useState(transaction.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const jobs: Promise<unknown>[] = []
      if (canEditCategory && categoryId && categoryId !== (transaction.category?.id ?? '')) {
        jobs.push(api.categorizeTransactionGroup([transaction.id], categoryId))
      }
      if (note.trim() !== (transaction.note ?? '')) {
        jobs.push(api.updateTransactionNote(transaction.id, note.trim() || null))
      }
      await Promise.all(jobs)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={transaction.description}
      subtitle={
        <>
          {formatFullDate(transaction.date)}
          {transaction.broker && ` · ${transaction.broker.name}`}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className={styles.amountRow}>
        <span className={styles.amountValue}>
          <Money>R$ {currency(transaction.amount)}</Money>
        </span>
        <InstallmentBadge number={transaction.installmentNumber} total={transaction.totalInstallments} />
        {transaction.awaitingPluggyMatch && <span className={styles.pendingPill}>pendente</span>}
      </div>

      {transaction.isTransfer ? (
        <p className={styles.staticNote}>Transferência — não conta como gasto, sem categoria.</p>
      ) : transaction.type === 'income' ? (
        <p className={styles.staticNote}>Receita de projeto — categoria automática.</p>
      ) : (
        <Select label="Categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={saving}>
          <option value="" disabled>
            Sem categoria
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
      )}

      <Input
        label="Nota (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Ex: Adidas"
        disabled={saving}
      />

      {error && <p className={styles.error}>{error}</p>}
    </ModalShell>
  )
}
