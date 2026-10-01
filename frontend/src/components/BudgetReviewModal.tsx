import { useEffect, useState } from 'react'
import { api, type BudgetReviewCategory } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { Input } from './Input'
import { ModalShell } from './ModalShell'
import styles from './BudgetReviewModal.module.css'

const KIND_LABEL: Record<string, string> = {
  essential: 'Essencial',
  non_essential: 'Não essencial',
  investment: 'Investimento',
}

/** "parcelas: R$ X → R$ Y" embaixo do gasto do mês passado — só quando a
 * parte parcelada muda de um mês pro outro (parcela que terminou, compra
 * nova parcelada). Explica por que a meta sugerida difere do mês passado. */
function InstallmentShift({ c }: { c: BudgetReviewCategory }) {
  if (Math.abs(c.previousInstallments - c.currentInstallments) < 0.01) return null
  return (
    <div className={styles.installmentShift}>
      parcelas: <Money>R$ {currency(c.previousInstallments)}</Money> → <Money>R$ {currency(c.currentInstallments)}</Money>
    </div>
  )
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
      // Sem meta ainda: começa pela sugestão (mês passado ajustado pelas
      // parcelas — ver `suggested` no backend), não pelo gasto cru.
      for (const c of r.categories) initial[c.categoryId] = String(c.currentTarget ?? Math.round(c.suggested * 100) / 100)
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
    <ModalShell
      title={`Revisar orçamento — ${String(month).padStart(2, '0')}/${year}`}
      maxWidth={640}
      onClose={onClose}
      footer={
        categories && (
          <>
            <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className={styles.confirmBtn} onClick={saveAll} disabled={saving}>
              {saving ? 'Salvando...' : `Salvar ${categories.length} categorias`}
            </button>
          </>
        )
      }
    >
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
                  {categories.map((c) => {
                    const parentTrail = c.path.split(' > ').slice(0, -1).join(' > ')
                    return (
                    <tr key={c.categoryId}>
                      <td>
                        {parentTrail && <div className={styles.parentTrail}>{parentTrail}</div>}
                        {c.name}
                      </td>
                      <td>
                        <span className={styles.kindTag}>{KIND_LABEL[c.kind]}</span>
                      </td>
                      <td className={styles.previousCell}>
                        <Money>R$ {currency(c.previousSpent)}</Money>
                        <InstallmentShift c={c} />
                      </td>
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
                    )
                  })}
                </tbody>
              </table>

              {/* Tela estreita: mesma conversão tabela→card do resto do app
                  (pedido do Luiz, 11/09). */}
              <div className={styles.cards}>
                {categories.map((c) => {
                  const parentTrail = c.path.split(' > ').slice(0, -1).join(' > ')
                  return (
                    <div key={c.categoryId} className={styles.card}>
                      <div className={styles.cardTop}>
                        <span>
                          {parentTrail && <div className={styles.parentTrail}>{parentTrail}</div>}
                          {c.name}
                        </span>
                        <span className={styles.kindTag}>{KIND_LABEL[c.kind]}</span>
                      </div>
                      <div className={styles.cardRow}>
                        <span className={styles.cardLabel}>Mês passado</span>
                        <span className={styles.cardPrevious}>
                          <Money>R$ {currency(c.previousSpent)}</Money>
                          <InstallmentShift c={c} />
                        </span>
                      </div>
                      <div className={styles.cardRow}>
                        <span className={styles.cardLabel}>Meta deste mês</span>
                        <Input
                          type="number"
                          step="0.01"
                          value={values[c.categoryId] ?? ''}
                          onChange={(e) => updateValue(c.categoryId, e.target.value)}
                          className={styles.rowInput}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
        </>
      )}
    </ModalShell>
  )
}
