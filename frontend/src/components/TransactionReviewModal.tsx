import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type UncategorizedTransactionGroup, type LeafCategoryOption } from '../lib/api'
import { currency } from '../lib/format'
import { Select } from './Select'
import styles from './TransactionReviewModal.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
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
  const [categoryId, setCategoryId] = useState('')
  const [saving, setSaving] = useState(false)

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

  return (
    <tr>
      <td>{group.description}</td>
      <td className={styles.numCell}>{group.count}x</td>
      <td className={styles.numCell}>{formatDate(group.lastDate)}</td>
      <td className={styles.numCell}>R$ {currency(group.totalAmount)}</td>
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
        <button className={styles.saveBtn} onClick={save} disabled={!categoryId || saving}>
          Salvar
        </button>
      </td>
    </tr>
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Compras sem categoria</h3>
            {groups && <p className={styles.subtitle}>{groups.length} comerciante(s) ainda sem categoria</p>}
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

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
          </div>
        )}
      </div>
    </div>
  )
}
