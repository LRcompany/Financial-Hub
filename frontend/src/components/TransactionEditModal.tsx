import { useState } from 'react'
import { Trash2 } from 'lucide-react'
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

interface SplitRow {
  categoryId: string
  amount: string
}

const SPLIT_TOLERANCE = 0.01

/** Editar categoria/nota de uma transação (11/09, pedido do Luiz: "a edição
 * tem que rolar através de modal e não diretamente na lista... assim não
 * fica intuitivo que dá pra clicar em nota e editar"). Antes cada linha da
 * lista JÁ vinha com Select/Input abertos direto (Orçamento > "Todas as
 * transações do mês") — clicar na linha abre isso aqui em vez disso, lista
 * fica só leitura. Componente ÚNICO usado em Orçamento e no Dashboard
 * ("Últimas transações") — mesma edição, dois lugares que mostram a mesma
 * lista, nunca duas modais duplicadas pro mesmo conceito.
 *
 * Dividir em categorias (14/09, pedido do Luiz: "o boleto do aluguel vem
 * com água, gás, internet e seguro juntos, como resolver isso?") — uma
 * despesa que representa VÁRIAS categorias na vida real vira N linhas
 * categoria+valor que precisam somar exatamente o valor da transação (o
 * valor real do banco nunca muda, só é redistribuído — ver
 * TransactionSplit no schema). */
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
  const isSplit = transaction.splits.length > 0
  // Só um lançamento MANUAL e AINDA NÃO CONFIRMADO pelo banco pode ser
  // apagado (14/09, pedido do Luiz: "quando vier do banco, não tem como
  // deletar"). `externalId` preenchido = a reconciliação (ver
  // pluggyTransactionSync.ts) já casou esse manual com a transação real —
  // ele continua `source: "manual"` de propósito (categoria escolhida à mão
  // nunca é sobrescrita), mas nesse ponto já é dinheiro confirmado que saiu
  // da conta de verdade, não dá mais pra apagar (achado 14/09 investigando
  // por que um boleto não tinha reconciliado: um manual JÁ reconciliado
  // com `source === 'manual'` sozinho passaria despercebido por esse gate).
  const canDelete = transaction.source === 'manual' && transaction.externalId == null
  const [categoryId, setCategoryId] = useState(transaction.category?.id ?? '')
  const [note, setNote] = useState(transaction.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [splitMode, setSplitMode] = useState(isSplit)
  const [splitRows, setSplitRows] = useState<SplitRow[]>(
    isSplit ? transaction.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount.toFixed(2) })) : []
  )
  const [undoingSplit, setUndoingSplit] = useState(false)

  function startSplit() {
    // Primeira linha já vem com o valor cheio (e a categoria já escolhida,
    // se tinha uma) — o Luiz só precisa "tirar" o pedaço das outras
    // categorias da primeira, não montar tudo do zero.
    setSplitRows([
      { categoryId, amount: transaction.amount.toFixed(2) },
      { categoryId: '', amount: '0' },
    ])
    setSplitMode(true)
    setError(null)
  }

  function cancelSplit() {
    setSplitMode(false)
    setSplitRows([])
    setError(null)
  }

  function updateSplitRow(index: number, field: keyof SplitRow, value: string) {
    setSplitRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function addSplitRow() {
    setSplitRows((rows) => [...rows, { categoryId: '', amount: '0' }])
  }

  function removeSplitRow(index: number) {
    setSplitRows((rows) => rows.filter((_, i) => i !== index))
  }

  const splitAllocated = splitRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const splitRemaining = transaction.amount - splitAllocated

  async function handleUndoSplit() {
    setUndoingSplit(true)
    setError(null)
    try {
      await api.clearTransactionSplit(transaction.id)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUndoingSplit(false)
    }
  }

  async function handleSave() {
    setError(null)
    if (splitMode) {
      if (splitRows.some((r) => !r.categoryId || !(Number(r.amount) > 0))) {
        setError('Toda linha precisa de categoria e um valor maior que zero.')
        return
      }
      if (Math.abs(splitRemaining) > SPLIT_TOLERANCE) {
        setError(
          splitRemaining > 0
            ? `Falta distribuir R$ ${currency(splitRemaining)}.`
            : `Passou R$ ${currency(Math.abs(splitRemaining))} do valor da transação.`
        )
        return
      }
    }
    setSaving(true)
    try {
      const jobs: Promise<unknown>[] = []
      if (splitMode) {
        jobs.push(api.splitTransaction(transaction.id, splitRows.map((r) => ({ categoryId: r.categoryId, amount: Number(r.amount) }))))
      } else if (canEditCategory && categoryId && categoryId !== (transaction.category?.id ?? '')) {
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

  // Clique armado (mesmo padrão de CategoryManager: 1º clique arma, 2º
  // confirma de verdade) — apagar uma transação inteira merece um passo a
  // mais, diferente de trocar categoria/nota.
  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await api.deleteTransaction(transaction.id)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const busy = saving || deleting || undoingSplit

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
          {canDelete && (
            <button
              type="button"
              className={confirmDelete ? styles.deleteConfirmBtn : styles.deleteBtn}
              onClick={handleDelete}
              disabled={busy}
            >
              {deleting ? 'Apagando...' : confirmDelete ? 'Confirmar exclusão' : 'Excluir'}
            </button>
          )}
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={busy}>
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
      ) : splitMode ? (
        <div className={styles.splitBlock}>
          <div className={styles.splitHeader}>
            <span className={styles.splitLabel}>Dividida em categorias</span>
            {isSplit ? (
              <button type="button" className={styles.splitLinkBtn} onClick={handleUndoSplit} disabled={busy}>
                {undoingSplit ? 'Desfazendo...' : 'Desfazer divisão'}
              </button>
            ) : (
              <button type="button" className={styles.splitLinkBtn} onClick={cancelSplit} disabled={busy}>
                Cancelar divisão
              </button>
            )}
          </div>

          {splitRows.map((row, i) => (
            <div className={styles.splitRow} key={i}>
              <Select
                aria-label="Categoria"
                value={row.categoryId}
                onChange={(e) => updateSplitRow(i, 'categoryId', e.target.value)}
                disabled={saving}
                className={styles.splitCategorySelect}
              >
                <option value="" disabled>
                  Categoria
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="Valor"
                type="number"
                step="0.01"
                value={row.amount}
                onChange={(e) => updateSplitRow(i, 'amount', e.target.value)}
                disabled={saving}
                className={styles.splitAmountInput}
              />
              <button
                type="button"
                className={styles.splitRemoveBtn}
                onClick={() => removeSplitRow(i)}
                disabled={saving || splitRows.length <= 2}
                aria-label="Remover categoria"
                title="Remover categoria"
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          ))}

          <button type="button" className={styles.splitAddBtn} onClick={addSplitRow} disabled={saving}>
            + Adicionar categoria
          </button>

          <p className={Math.abs(splitRemaining) > SPLIT_TOLERANCE ? styles.splitRemainingWarn : styles.splitRemainingOk}>
            {Math.abs(splitRemaining) <= SPLIT_TOLERANCE
              ? 'Valores batem com o total da transação.'
              : splitRemaining > 0
                ? `Falta distribuir R$ ${currency(splitRemaining)}.`
                : `R$ ${currency(Math.abs(splitRemaining))} acima do valor da transação.`}
          </p>
        </div>
      ) : (
        <>
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
          {/* Boleto/fatura que junta mais de uma categoria (aluguel+água+
              gás+internet+seguro, ex.) — pedido do Luiz, 14/09. */}
          <button type="button" className={styles.splitStartBtn} onClick={startSplit} disabled={saving}>
            Dividir esta transação em categorias
          </button>
        </>
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
