import { useEffect, useState } from 'react'
import { api, type InstallmentGroup, type LeafCategoryOption } from '../lib/api'
import { Input } from './Input'
import { Select } from './Select'
import { ModalShell } from './ModalShell'
import styles from './InstallmentReviewModal.module.css'

const OTHER = '__other__'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

type GroupFormProps = {
  group: InstallmentGroup
  categories: LeafCategoryOption[]
  onSaved: (
    ids: string[],
    changes: { cardLabel: string | null; amount: number; categoryId: string | null; categoryPath: string | null; note: string | null; totalInstallments: number | null }
  ) => void
  onDeleted: (ids: string[]) => void
}

/** Estado + handlers de edição de uma compra parcelada — compartilhado entre
 * `GroupRow` (tabela, desktop) e `GroupCard` (mobile, 11/09), pra não
 * duplicar a lógica de salvar/excluir em dois lugares (só a apresentação
 * muda). Cada instância (linha OU card) tem seu próprio estado — só uma das
 * duas fica visível por vez via CSS, nunca as duas ao mesmo tempo. */
function useGroupForm({ group, categories, onSaved, onDeleted }: GroupFormProps) {
  const [cardChoice, setCardChoice] = useState(group.cardLabel ?? '')
  const [customCard, setCustomCard] = useState('')
  const [categoryChoice, setCategoryChoice] = useState(group.categoryId ?? '')
  const [amount, setAmount] = useState(String(group.amount))
  const [note, setNote] = useState(group.note ?? '')
  const [totalInstallments, setTotalInstallments] = useState(group.totalInstallments != null ? String(group.totalInstallments) : '')
  const [saving, setSaving] = useState(false)

  const isOther = cardChoice === OTHER
  const dirty =
    cardChoice !== (group.cardLabel ?? '') ||
    Number(amount) !== group.amount ||
    categoryChoice !== (group.categoryId ?? '') ||
    note !== (group.note ?? '') ||
    totalInstallments !== (group.totalInstallments != null ? String(group.totalInstallments) : '') ||
    (isOther && customCard.trim() !== '')

  async function save() {
    const cardLabel = isOther ? customCard.trim() || null : cardChoice || null
    const numericAmount = Number(amount)
    if (Number.isNaN(numericAmount) || numericAmount < 0) return
    const trimmedTotal = totalInstallments.trim()
    const numericTotal = trimmedTotal === '' ? null : Number(trimmedTotal)
    if (numericTotal !== null && (Number.isNaN(numericTotal) || !Number.isInteger(numericTotal) || numericTotal <= 0)) return
    setSaving(true)
    try {
      const trimmedNote = note.trim() || null
      await api.updateInstallmentGroup(group.ids, {
        cardLabel,
        amount: numericAmount,
        categoryId: categoryChoice || null,
        note: trimmedNote,
        totalInstallments: numericTotal,
      })
      const categoryPath = categories.find((c) => c.id === categoryChoice)?.path ?? null
      onSaved(group.ids, { cardLabel, amount: numericAmount, categoryId: categoryChoice || null, categoryPath, note: trimmedNote, totalInstallments: numericTotal })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Remover "${group.description}" (${group.count} parcela${group.count > 1 ? 's' : ''}) — confirma que é duplicata ou erro?`)) return
    setSaving(true)
    try {
      await api.deleteInstallmentGroup(group.ids)
      onDeleted(group.ids)
    } finally {
      setSaving(false)
    }
  }

  return {
    cardChoice,
    setCardChoice,
    customCard,
    setCustomCard,
    categoryChoice,
    setCategoryChoice,
    amount,
    setAmount,
    note,
    setNote,
    totalInstallments,
    setTotalInstallments,
    saving,
    isOther,
    dirty,
    save,
    remove,
  }
}

/** Uma linha editável por compra (não por parcela — as N parcelas restantes
 * da mesma compra mudam juntas, é a mesma correção pra todas). */
function GroupRow({ group, knownCards, categories, onSaved, onDeleted }: GroupFormProps & { knownCards: string[] }) {
  const {
    cardChoice,
    setCardChoice,
    customCard,
    setCustomCard,
    categoryChoice,
    setCategoryChoice,
    amount,
    setAmount,
    note,
    setNote,
    totalInstallments,
    setTotalInstallments,
    saving,
    isOther,
    dirty,
    save,
    remove,
  } = useGroupForm({ group, categories, onSaved, onDeleted })

  return (
    <tr className={group.categoryId === null ? styles.unconfiguredRow : ''}>
      <td>{group.description}</td>
      <td>
        <Input
          placeholder="O que foi essa compra?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={styles.noteInput}
          disabled={saving}
        />
      </td>
      <td className={styles.numCell}>
        <Input
          type="number"
          step="1"
          min="1"
          placeholder="?"
          value={totalInstallments}
          onChange={(e) => setTotalInstallments(e.target.value)}
          className={styles.totalInput}
          disabled={saving}
        />
        <span className={styles.remainingHint}>
          {/* Parcela(s) que já viraram Transaction (08/09) — sem isso
              parecia que a compra só tinha as futuras, como se a 1ª nunca
              tivesse acontecido. "Lançada", não "paga": o Luiz corrigiu
              (08/09) que não existe parcela paga isoladamente — ele sempre
              paga a fatura inteira do cartão fechada; a parcela virar
              Transaction só significa que ela já entrou na fatura desse
              mês, não que foi quitada à parte. */}
          {group.paidCount > 0 && `${group.paidCount} já lançada${group.paidCount > 1 ? 's' : ''} · `}
          {group.count}x restante{group.count > 1 ? 's' : ''}
        </span>
      </td>
      <td className={styles.numCell}>
        {formatDate(group.firstDueDate)}
        {group.count > 1 ? ` — ${formatDate(group.lastDueDate)}` : ''}
      </td>
      <td>
        <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={styles.amountInput} disabled={saving} />
      </td>
      <td>
        <Select value={cardChoice} onChange={(e) => setCardChoice(e.target.value)} className={styles.cardSelect} disabled={saving}>
          <option value="">— sem cartão —</option>
          {knownCards.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OTHER}>Outro...</option>
        </Select>
        {isOther && (
          <Input
            placeholder="Nome do cartão"
            value={customCard}
            onChange={(e) => setCustomCard(e.target.value)}
            className={styles.customCardInput}
            disabled={saving}
          />
        )}
      </td>
      <td>
        <Select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)} className={styles.categorySelect} disabled={saving}>
          <option value="">— sem categoria —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
      </td>
      <td className={styles.actionsCell}>
        <button className={styles.saveBtn} onClick={save} disabled={!dirty || saving}>
          Salvar
        </button>
        <button className={styles.deleteBtn} onClick={remove} disabled={saving} aria-label="Remover (duplicata)">
          Excluir
        </button>
      </td>
    </tr>
  )
}

/** Mesma compra da `GroupRow` (tabela), em formato de card — tela estreita
 * (pedido do Luiz, 11/09). Mesmo hook `useGroupForm`, só a apresentação
 * muda. */
function GroupCard({ group, knownCards, categories, onSaved, onDeleted }: GroupFormProps & { knownCards: string[] }) {
  const {
    cardChoice,
    setCardChoice,
    customCard,
    setCustomCard,
    categoryChoice,
    setCategoryChoice,
    amount,
    setAmount,
    note,
    setNote,
    totalInstallments,
    setTotalInstallments,
    saving,
    isOther,
    dirty,
    save,
    remove,
  } = useGroupForm({ group, categories, onSaved, onDeleted })

  return (
    <div className={`${styles.card} ${group.categoryId === null ? styles.unconfiguredCard : ''}`}>
      <div className={styles.cardTop}>{group.description}</div>

      <Input placeholder="O que foi essa compra?" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} />

      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Total parcelas</span>
        <span className={styles.cardInlineField}>
          <Input
            type="number"
            step="1"
            min="1"
            placeholder="?"
            value={totalInstallments}
            onChange={(e) => setTotalInstallments(e.target.value)}
            className={styles.totalInput}
            disabled={saving}
          />
          <span className={styles.remainingHint}>
            {group.paidCount > 0 && `${group.paidCount} já lançada${group.paidCount > 1 ? 's' : ''} · `}
            {group.count}x restante{group.count > 1 ? 's' : ''}
          </span>
        </span>
      </div>

      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Período</span>
        <span>
          {formatDate(group.firstDueDate)}
          {group.count > 1 ? ` — ${formatDate(group.lastDueDate)}` : ''}
        </span>
      </div>

      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Valor/parcela</span>
        <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={styles.amountInput} disabled={saving} />
      </div>

      <div className={styles.cardField}>
        <span className={styles.cardLabel}>Cartão</span>
        <Select value={cardChoice} onChange={(e) => setCardChoice(e.target.value)} disabled={saving}>
          <option value="">— sem cartão —</option>
          {knownCards.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OTHER}>Outro...</option>
        </Select>
        {isOther && (
          <Input placeholder="Nome do cartão" value={customCard} onChange={(e) => setCustomCard(e.target.value)} disabled={saving} />
        )}
      </div>

      <div className={styles.cardField}>
        <span className={styles.cardLabel}>Categoria</span>
        <Select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)} disabled={saving}>
          <option value="">— sem categoria —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
      </div>

      <div className={styles.cardActions}>
        <button className={styles.saveBtn} onClick={save} disabled={!dirty || saving}>
          Salvar
        </button>
        <button className={styles.deleteBtn} onClick={remove} disabled={saving} aria-label="Remover (duplicata)">
          Excluir
        </button>
      </div>
    </div>
  )
}

export function InstallmentReviewModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<InstallmentGroup[] | null>(null)
  const [knownCards, setKnownCards] = useState<string[]>([])
  const [categories, setCategories] = useState<LeafCategoryOption[]>([])

  function load() {
    api.installmentGroups().then((r) => {
      setGroups(r.groups)
      setKnownCards(r.knownCards)
      setCategories(r.categories)
    })
  }

  useEffect(load, [])

  function handleSaved(
    ids: string[],
    changes: { cardLabel: string | null; amount: number; categoryId: string | null; categoryPath: string | null; note: string | null; totalInstallments: number | null }
  ) {
    setGroups((prev) => prev?.map((g) => (g.ids === ids || sameIds(g.ids, ids) ? { ...g, ...changes } : g)) ?? null)
  }

  function handleDeleted(ids: string[]) {
    setGroups((prev) => prev?.filter((g) => !sameIds(g.ids, ids)) ?? null)
  }

  function sameIds(a: string[], b: string[]) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }

  const unconfigured = groups?.filter((g) => g.categoryId === null) ?? []
  const configured = groups?.filter((g) => g.categoryId !== null) ?? []

  return (
    <ModalShell
      title="Revisar parcelas futuras"
      subtitle={
        groups && (
          <>
            {unconfigured.length} compra{unconfigured.length !== 1 ? 's' : ''} sem categoria · {configured.length} já categorizada
            {configured.length !== 1 ? 's' : ''}
          </>
        )
      }
      maxWidth={860}
      onClose={onClose}
    >
      {!groups && <p className={styles.loading}>Carregando parcelas...</p>}

      {groups && (
          <div className={styles.listWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Descrição</th>
                  <th>Total parcelas</th>
                  <th>Período</th>
                  <th>Valor/parcela</th>
                  <th>Cartão</th>
                  <th>Categoria</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unconfigured.map((g) => (
                  <GroupRow key={g.ids.join(',')} group={g} knownCards={knownCards} categories={categories} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))}
                {configured.map((g) => (
                  <GroupRow key={g.ids.join(',')} group={g} knownCards={knownCards} categories={categories} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))}
              </tbody>
            </table>

            {/* Tela estreita: mesma conversão tabela→card do resto do app
                (pedido do Luiz, 11/09). */}
            <div className={styles.cards}>
              {unconfigured.map((g) => (
                <GroupCard key={g.ids.join(',')} group={g} knownCards={knownCards} categories={categories} onSaved={handleSaved} onDeleted={handleDeleted} />
              ))}
              {configured.map((g) => (
                <GroupCard key={g.ids.join(',')} group={g} knownCards={knownCards} categories={categories} onSaved={handleSaved} onDeleted={handleDeleted} />
              ))}
            </div>
          </div>
        )}
    </ModalShell>
  )
}
