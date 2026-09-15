import { useEffect, useState } from 'react'
import { api, type UncategorizedTransactionGroup, type LeafCategoryOption } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { Select } from './Select'
import { InstallmentBadge } from './Badge'
import { ModalShell } from './ModalShell'
import { SplitEditor, initialSplitRows, validateSplitRows, type SplitRowValue } from './SplitEditor'
import styles from './TransactionReviewModal.module.css'
import splitStyles from './SplitEditor.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Uma linha por comerciante (mesma descrição exata = mesmo comerciante —
 * categoriza todas as compras dele de uma vez, mesmo com valor diferente
 * cada uma). Sem edição de valor/cartão aqui — isso é gasto que JÁ
 * aconteceu (Transaction), diferente da parcela futura.
 *
 * "Dividir" (14/09, pedido do Luiz: o boleto de aluguel+água+gás+internet+
 * seguro cai aqui como "1 comerciante sem categoria") só faz sentido pra um
 * grupo de UMA transação — dividir é uma decisão sobre um valor específico
 * (essa fatura desse mês), não algo que dá pra aplicar em bloco pra N
 * compras de valores diferentes do mesmo comerciante. Reaproveita o mesmo
 * `SplitEditor` do `TransactionEditModal` — nunca uma segunda versão da UI
 * de dividir. */
function GroupRow({
  group,
  categories,
  onSaved,
}: {
  group: UncategorizedTransactionGroup
  categories: LeafCategoryOption[]
  onSaved: (ids: string[]) => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitRows, setSplitRows] = useState<SplitRowValue[]>([])
  const [splitError, setSplitError] = useState<string | null>(null)

  async function save() {
    if (!categoryId) return
    setSaving(true)
    try {
      await api.categorizeTransactionGroup(group.ids, categoryId)
      onSaved(group.ids)
    } finally {
      setSaving(false)
    }
  }

  function startSplit() {
    setSplitRows(initialSplitRows(group.totalAmount))
    setSplitMode(true)
    setSplitError(null)
  }

  async function saveSplit() {
    const validationError = validateSplitRows(splitRows, group.totalAmount)
    if (validationError) {
      setSplitError(validationError)
      return
    }
    setSaving(true)
    setSplitError(null)
    try {
      await api.splitTransaction(group.ids[0], splitRows.map((r) => ({ categoryId: r.categoryId, amount: Number(r.amount) })))
      onSaved(group.ids)
    } catch (err) {
      setSplitError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (splitMode) {
    return (
      <tr>
        <td colSpan={6} className={styles.splitCell}>
          <div className={splitStyles.splitHeader}>
            <span className={splitStyles.splitLabel}>{group.description} — dividir em categorias</span>
            <button type="button" className={splitStyles.splitLinkBtn} onClick={() => setSplitMode(false)} disabled={saving}>
              Cancelar divisão
            </button>
          </div>
          <SplitEditor rows={splitRows} onChange={setSplitRows} categories={categories} totalAmount={group.totalAmount} disabled={saving} />
          {splitError && <p className={styles.error}>{splitError}</p>}
          <button type="button" className={styles.saveBtn} onClick={saveSplit} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar divisão'}
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>
        {group.description}
        {/* Compra parcelada (08/09, pedido do Luiz: "deixa marcado que é
            uma compra parcelada") — sem isso a compra aparecia igualzinha
            a qualquer transação avulsa, só com a opção de categorizar. */}
        <InstallmentBadge number={group.installmentNumber} total={group.totalInstallments} />
      </td>
      <td className={styles.numCell}>{group.count}x</td>
      <td className={styles.numCell}>{formatDate(group.lastDate)}</td>
      <td className={styles.numCell}><Money>R$ {currency(group.totalAmount)}</Money></td>
      <td>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={styles.categorySelect} disabled={saving}>
          <option value="">— escolher —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
      </td>
      <td>
        <div className={styles.rowActions}>
          <button className={styles.saveBtn} onClick={save} disabled={!categoryId || saving}>
            Salvar
          </button>
          {group.count === 1 && (
            <button type="button" className={splitStyles.splitLinkBtn} onClick={startSplit} disabled={saving}>
              Dividir
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

/** Mesmo comerciante da `GroupRow` (tabela), em formato de card — pra tela
 * estreita, onde tabela vira sempre card (pedido do Luiz, 11/09: "toda
 * célula numa table vira um card... não rola termos tabela no mobile").
 * Estado próprio (não compartilha com `GroupRow`) — só uma das duas versões
 * fica visível de cada vez via CSS, nunca as duas ao mesmo tempo. */
function GroupCard({
  group,
  categories,
  onSaved,
}: {
  group: UncategorizedTransactionGroup
  categories: LeafCategoryOption[]
  onSaved: (ids: string[]) => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitRows, setSplitRows] = useState<SplitRowValue[]>([])
  const [splitError, setSplitError] = useState<string | null>(null)

  async function save() {
    if (!categoryId) return
    setSaving(true)
    try {
      await api.categorizeTransactionGroup(group.ids, categoryId)
      onSaved(group.ids)
    } finally {
      setSaving(false)
    }
  }

  function startSplit() {
    setSplitRows(initialSplitRows(group.totalAmount))
    setSplitMode(true)
    setSplitError(null)
  }

  async function saveSplit() {
    const validationError = validateSplitRows(splitRows, group.totalAmount)
    if (validationError) {
      setSplitError(validationError)
      return
    }
    setSaving(true)
    setSplitError(null)
    try {
      await api.splitTransaction(group.ids[0], splitRows.map((r) => ({ categoryId: r.categoryId, amount: Number(r.amount) })))
      onSaved(group.ids)
    } catch (err) {
      setSplitError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (splitMode) {
    return (
      <div className={styles.card}>
        <div className={splitStyles.splitHeader}>
          <span className={splitStyles.splitLabel}>{group.description}</span>
          <button type="button" className={splitStyles.splitLinkBtn} onClick={() => setSplitMode(false)} disabled={saving}>
            Cancelar divisão
          </button>
        </div>
        <SplitEditor rows={splitRows} onChange={setSplitRows} categories={categories} totalAmount={group.totalAmount} disabled={saving} />
        {splitError && <p className={styles.error}>{splitError}</p>}
        <button type="button" className={styles.saveBtn} onClick={saveSplit} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar divisão'}
        </button>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        {group.description}
        <InstallmentBadge number={group.installmentNumber} total={group.totalInstallments} />
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Compras</span>
        <span>{group.count}x</span>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Última</span>
        <span>{formatDate(group.lastDate)}</span>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Total</span>
        <span><Money>R$ {currency(group.totalAmount)}</Money></span>
      </div>
      <div className={styles.cardActions}>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={saving}>
          <option value="">— escolher —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
        <button className={styles.saveBtn} onClick={save} disabled={!categoryId || saving}>
          Salvar
        </button>
      </div>
      {group.count === 1 && (
        <button type="button" className={`${splitStyles.splitLinkBtn} ${styles.cardSplitBtn}`} onClick={startSplit} disabled={saving}>
          Dividir em categorias
        </button>
      )}
    </div>
  )
}

export function TransactionReviewModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<UncategorizedTransactionGroup[] | null>(null)
  const [categories, setCategories] = useState<LeafCategoryOption[]>([])

  function load() {
    api.uncategorizedTransactionGroups().then((r) => {
      setGroups(r.groups)
      setCategories(r.categories)
    })
  }

  useEffect(load, [])

  function sameIds(a: string[], b: string[]) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }

  function handleSaved(ids: string[]) {
    setGroups((prev) => prev?.filter((g) => !sameIds(g.ids, ids)) ?? null)
  }

  return (
    <ModalShell
      title="Compras sem categoria"
      subtitle={groups ? `${groups.length} comerciante(s) ainda sem categoria` : undefined}
      maxWidth={960}
      onClose={onClose}
    >
      {!groups && <p className={styles.loading}>Carregando...</p>}
      {groups && groups.length === 0 && <p className={styles.loading}>Tudo categorizado — nada pendente aqui.</p>}

      {groups && groups.length > 0 && (
        <div className={styles.listWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Comerciante</th>
                <th>Compras</th>
                <th>Última</th>
                <th>Total</th>
                <th>Categoria</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRow key={g.description} group={g} categories={categories} onSaved={handleSaved} />
              ))}
            </tbody>
          </table>

          {/* Tela estreita: mesma conversão tabela→card do resto do app
              (pedido do Luiz, 11/09). */}
          <div className={styles.cards}>
            {groups.map((g) => (
              <GroupCard key={g.description} group={g} categories={categories} onSaved={handleSaved} />
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  )
}
