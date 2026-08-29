import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type BudgetReviewCategory } from '../lib/api'
import { currency } from '../lib/format'
import { Input } from './Input'
import styles from './BudgetReviewModal.module.css'

const KIND_LABEL: Record<string, string> = {
  essential: 'Essencial',
  non_essential: 'Não essencial',
  investment: 'Investimento',
}

/** Revisão de orçamento em lista — todas as categorias de uma vez, valor do
 * mês passado ao lado do campo novo, salva tudo junto. Luiz pediu
 * explicitamente que NÃO fosse passo a passo (uma tela por categoria é lento
 * pra conferir e ele prefere ver tudo e comparar rápido). */
export function BudgetReviewModal({ month, year, onClose, onSaved }: { month: number; year: number; onClose: () => void; onSaved: () => void }) {
  const [categories, setCategories] = useState<BudgetReviewCategory[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.budgetReview(month, year).then((r) => {
      setCategories(r.categories)
      const initial: Record<string, string> = {}
      for (const c of r.categories) initial[c.categoryId] = String(c.currentTarget ?? c.previousSpent)
      setValues(initial)
    })
  }, [month, year])

  function updateValue(categoryId: string, v: string) {
    setValues((prev) => ({ ...prev, [categoryId]: v }))
  }

  async function saveAll() {
    if (!categories) return
    setSaving(true)
    try {
      // só grava quem realmente tem um número válido — categoria que ele
      // deixou em branco de propósito não vira meta de R$0 fake.
      const toSave = categories.filter((c) => {
        const v = values[c.categoryId]
        return v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0
      })
      await Promise.all(toSave.map((c) => api.setBudgetTarget(c.categoryId, month, year, Number(values[c.categoryId]))))
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            Revisar orçamento — {String(month).padStart(2, '0')}/{year}
          </h3>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {!categories && <p className={styles.loading}>Carregando categorias...</p>}

        {categories && (
          <>
            <div className={styles.listWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Tipo</th>
                    <th>Mês passado</th>
                    <th>Meta deste mês</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.categoryId}>
                      <td>{c.name}</td>
                      <td>
                        <span className={styles.kindTag}>{KIND_LABEL[c.kind]}</span>
                      </td>
                      <td className={styles.previousCell}>R$ {currency(c.previousSpent)}</td>
                      <td>
                        <Input
                          type="number"
                          step="0.01"
                          value={values[c.categoryId] ?? ''}
                          onChange={(e) => updateValue(c.categoryId, e.target.value)}
                          className={styles.rowInput}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button className={styles.confirmBtn} onClick={saveAll} disabled={saving}>
                {saving ? 'Salvando...' : `Salvar ${categories.length} categorias`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
