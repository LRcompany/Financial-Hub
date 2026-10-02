import { useState } from 'react'
import { api, type Transaction, type LeafCategoryOption } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { Input } from './Input'
import { Select } from './Select'
import { InstallmentBadge } from './Badge'
import { ModalShell } from './ModalShell'
import { SplitEditor, initialSplitRows, validateSplitRows, type SplitRowValue } from './SplitEditor'
import styles from './TransactionEditModal.module.css'
import splitStyles from './SplitEditor.module.css'

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
 * lista, nunca duas modais duplicadas pro mesmo conceito.
 *
 * Dividir em categorias (14/09, pedido do Luiz: "o boleto do aluguel vem
 * com água, gás, internet e seguro juntos, como resolver isso?") — editor
 * em si é `SplitEditor` (compartilhado com `TransactionReviewModal`), aqui
 * só o botão de convite + o "Desfazer"/"Cancelar" ao redor dele. */
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
  const [splitRows, setSplitRows] = useState<SplitRowValue[]>(
    isSplit ? transaction.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount.toFixed(2) })) : []
  )
  const [undoingSplit, setUndoingSplit] = useState(false)

  function startSplit() {
    setSplitRows(initialSplitRows(transaction.amount, categoryId))
    setSplitMode(true)
    setError(null)
  }

  function cancelSplit() {
    setSplitMode(false)
    setSplitRows([])
    setError(null)
  }

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
      const validationError = validateSplitRows(splitRows, transaction.amount)
      if (validationError) {
        setError(validationError)
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
        <div className={splitStyles.splitBlock}>
          <div className={splitStyles.splitHeader}>
            <span className={splitStyles.splitLabel}>Dividida em categorias</span>
            {isSplit ? (
              <button type="button" className={splitStyles.splitLinkBtn} onClick={handleUndoSplit} disabled={busy}>
                {undoingSplit ? 'Desfazendo...' : 'Desfazer divisão'}
              </button>
            ) : (
              <button type="button" className={splitStyles.splitLinkBtn} onClick={cancelSplit} disabled={busy}>
                Cancelar divisão
              </button>
            )}
          </div>
          <SplitEditor rows={splitRows} onChange={setSplitRows} categories={categories} totalAmount={transaction.amount} disabled={saving} />
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
          <button
            type="button"
            className={`${splitStyles.splitStartBtn} ${styles.splitStartBtnSpacing}`}
            onClick={startSplit}
            disabled={saving}
          >
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
