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

/** Revisão de orçamento passo a passo, uma categoria por vez — o pedido do
 * Luiz é literal: "gastei 600 de terapia mês passado, posso ou não continuar
 * com esse orçamento". Cada tela mostra exatamente esse número (gasto real
 * do mês anterior) já pré-preenchido no campo, só confirma ou ajusta. */
export function BudgetReviewModal({ month, year, onClose, onSaved }: { month: number; year: number; onClose: () => void; onSaved: () => void }) {
  const [categories, setCategories] = useState<BudgetReviewCategory[] | null>(null)
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.budgetReview(month, year).then((r) => {
      setCategories(r.categories)
      const first = r.categories[0]
      setValue(first ? String(first.currentTarget ?? first.previousSpent) : '')
    })
  }, [month, year])

  const current = categories?.[index]

  function goTo(nextIndex: number) {
    setIndex(nextIndex)
    const next = categories?.[nextIndex]
    setValue(next ? String(next.currentTarget ?? next.previousSpent) : '')
  }

  async function confirmAndNext() {
    if (!current) return
    const amount = Number(value)
    if (Number.isNaN(amount) || amount < 0) return
    setSaving(true)
    try {
      await api.setBudgetTarget(current.categoryId, month, year, amount)
      advance()
    } finally {
      setSaving(false)
    }
  }

  function skip() {
    advance()
  }

  function advance() {
    if (!categories) return
    if (index + 1 >= categories.length) {
      onSaved()
      return
    }
    goTo(index + 1)
  }

  if (!categories) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
          <p className={styles.loading}>Carregando categorias...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.progress}>
            {index + 1} de {categories.length}
          </span>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {current && (
          <>
            <span className={styles.kindTag}>{KIND_LABEL[current.kind]}</span>
            <h3 className={styles.categoryName}>{current.name}</h3>
            <p className={styles.previousSpent}>
              Mês passado você gastou <strong>R$ {currency(current.previousSpent)}</strong>
              {current.currentTarget != null && <> — meta atual: R$ {currency(current.currentTarget)}</>}
            </p>
            <Input
              label="Meta para esse mês (R$)"
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <div className={styles.actions}>
              <button className={styles.skipBtn} onClick={skip} disabled={saving}>
                Pular
              </button>
              <button className={styles.confirmBtn} onClick={confirmAndNext} disabled={saving}>
                {index + 1 >= categories.length ? 'Confirmar e finalizar' : 'Confirmar e próxima'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
