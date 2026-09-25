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

type GroupItem = UncategorizedTransactionGroup['items'][number]

/** Estado compartilhado de "categorizar / dividir" de um grupo — usado pela
 * linha (`GroupRow`, desktop) e pelo card (`GroupCard`, mobile), que antes
 * duplicavam essa lógica inteira.
 *
 * "Dividir" (14/09, boleto de aluguel+água+gás+internet+seguro) é uma
 * decisão sobre UM valor específico, nunca em bloco. Grupo de 1 transação
 * abre o editor direto; grupo de 2+ (23/09, pedido do Luiz: dois Pix pra
 * conta do CNPJ — R$580 e R$1,10 — caíram no mesmo grupo por terem o mesmo
 * nome, e o "Dividir" nem aparecia) pergunta antes QUAL transação dividir.
 * Dividir uma só não some com o grupo — só tira aquela transação dele
 * (`onSaved([id])`), o resto continua esperando categoria. */
function useGroupActions(group: UncategorizedTransactionGroup, onSaved: (ids: string[]) => void) {
  const [categoryId, setCategoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'idle' | 'pick' | 'split'>('idle')
  const [target, setTarget] = useState<GroupItem | null>(null)
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

  function chooseTarget(item: GroupItem) {
    setTarget(item)
    setSplitRows(initialSplitRows(item.amount))
    setSplitError(null)
    setMode('split')
  }

  function startSplit() {
    if (group.items.length === 1) chooseTarget(group.items[0])
    else setMode('pick')
  }

  function cancelSplit() {
    setMode('idle')
    setTarget(null)
    setSplitError(null)
  }

  async function saveSplit() {
    if (!target) return
    const validationError = validateSplitRows(splitRows, target.amount)
    if (validationError) {
      setSplitError(validationError)
      return
    }
    setSaving(true)
    setSplitError(null)
    try {
      await api.splitTransaction(target.id, splitRows.map((r) => ({ categoryId: r.categoryId, amount: Number(r.amount) })))
      const doneId = target.id
      cancelSplit()
      onSaved([doneId])
    } catch (err) {
      setSplitError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return { categoryId, setCategoryId, saving, mode, target, splitRows, setSplitRows, splitError, save, startSplit, chooseTarget, cancelSplit, saveSplit }
}

type GroupActions = ReturnType<typeof useGroupActions>

/** Passo "qual transação dividir?" + editor de divisão — mesmo miolo na
 * linha (dentro de um `<td colSpan>`) e no card. */
function SplitFlow({
  group,
  categories,
  a,
}: {
  group: UncategorizedTransactionGroup
  categories: LeafCategoryOption[]
  a: GroupActions
}) {
  if (a.mode === 'pick') {
    return (
      <>
        <div className={splitStyles.splitHeader}>
          <span className={splitStyles.splitLabel}>{group.description} — qual transação dividir?</span>
          <button type="button" className={splitStyles.splitLinkBtn} onClick={a.cancelSplit}>
            Cancelar
          </button>
        </div>
        <div className={styles.pickList}>
          {group.items.map((it) => (
            <button key={it.id} type="button" className={styles.pickItem} onClick={() => a.chooseTarget(it)}>
              <span>{formatDate(it.date)}</span>
              <strong>
                <Money>R$ {currency(it.amount)}</Money>
              </strong>
            </button>
          ))}
        </div>
      </>
    )
  }
  return (
    <>
      <div className={splitStyles.splitHeader}>
        <span className={splitStyles.splitLabel}>
          {group.description}
          {a.target && group.items.length > 1 && (
            <>
              {' '}— {formatDate(a.target.date)}, <Money>R$ {currency(a.target.amount)}</Money>
            </>
          )}
        </span>
        <button type="button" className={splitStyles.splitLinkBtn} onClick={a.cancelSplit} disabled={a.saving}>
          Cancelar divisão
        </button>
      </div>
      <SplitEditor rows={a.splitRows} onChange={a.setSplitRows} categories={categories} totalAmount={a.target?.amount ?? 0} disabled={a.saving} />
      {a.splitError && <p className={styles.error}>{a.splitError}</p>}
      <button type="button" className={styles.saveBtn} onClick={a.saveSplit} disabled={a.saving}>
        {a.saving ? 'Salvando...' : 'Salvar divisão'}
      </button>
    </>
  )
}

/** Uma linha por comerciante (mesma descrição exata = mesmo comerciante —
 * categoriza todas as compras dele de uma vez, mesmo com valor diferente
 * cada uma). Sem edição de valor/cartão aqui — isso é gasto que JÁ
 * aconteceu (Transaction), diferente da parcela futura. */
function GroupRow({
  group,
  categories,
  onSaved,
}: {
  group: UncategorizedTransactionGroup
  categories: LeafCategoryOption[]
  onSaved: (ids: string[]) => void
}) {
  const a = useGroupActions(group, onSaved)

  if (a.mode !== 'idle') {
    return (
      <tr>
        <td colSpan={6} className={styles.splitCell}>
          <SplitFlow group={group} categories={categories} a={a} />
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
        <Select value={a.categoryId} onChange={(e) => a.setCategoryId(e.target.value)} className={styles.categorySelect} disabled={a.saving}>
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
          <button className={styles.saveBtn} onClick={a.save} disabled={!a.categoryId || a.saving}>
            Salvar
          </button>
          <button type="button" className={splitStyles.splitLinkBtn} onClick={a.startSplit} disabled={a.saving}>
            Dividir
          </button>
        </div>
      </td>
    </tr>
  )
}

/** Mesmo comerciante da `GroupRow` (tabela), em formato de card — pra tela
 * estreita, onde tabela vira sempre card (pedido do Luiz, 11/09). Estado
 * próprio (não compartilha com `GroupRow`) — só uma das duas versões fica
 * visível de cada vez via CSS. */
function GroupCard({
  group,
  categories,
  onSaved,
}: {
  group: UncategorizedTransactionGroup
  categories: LeafCategoryOption[]
  onSaved: (ids: string[]) => void
}) {
  const a = useGroupActions(group, onSaved)

  if (a.mode !== 'idle') {
    return (
      <div className={styles.card}>
        <SplitFlow group={group} categories={categories} a={a} />
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
        <Select value={a.categoryId} onChange={(e) => a.setCategoryId(e.target.value)} disabled={a.saving}>
          <option value="">— escolher —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
        <button className={styles.saveBtn} onClick={a.save} disabled={!a.categoryId || a.saving}>
          Salvar
        </button>
      </div>
      <button type="button" className={`${splitStyles.splitLinkBtn} ${styles.cardSplitBtn}`} onClick={a.startSplit} disabled={a.saving}>
        Dividir em categorias
      </button>
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

  // Tira do grupo só as transações resolvidas (categorizar tudo = todas;
  // dividir uma = só ela) e recalcula total/quantidade; grupo vazio some.
  function handleSaved(ids: string[]) {
    const done = new Set(ids)
    setGroups(
      (prev) =>
        prev
          ?.map((g) => {
            const items = g.items.filter((it) => !done.has(it.id))
            return { ...g, items, ids: items.map((it) => it.id), count: items.length, totalAmount: items.reduce((sum, it) => sum + it.amount, 0) }
          })
          .filter((g) => g.count > 0) ?? null
    )
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
