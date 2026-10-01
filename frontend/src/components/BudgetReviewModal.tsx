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

/** Campo com número válido (>= 0). Em branco = Luiz decidiu não ter meta
 * nessa categoria esse mês — nunca vira meta de R$0 fake. */
function isFilled(v: string | undefined): boolean {
  return v != null && v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0
}

/** "parcelas em aberto: R$ Y" embaixo do gasto do mês passado — de onde vem
 * o valor pré-preenchido na meta. Só aparece quando há parcela neste mês. */
function InstallmentShift({ c }: { c: BudgetReviewCategory }) {
  if (c.currentInstallments < 0.01) return null
  return (
    <div className={styles.installmentShift}>
      parcelas em aberto: <Money>R$ {currency(c.currentInstallments)}</Money>
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
      // Sem meta ainda: pré-preenche SÓ com as parcelas em aberto que vencem
      // neste mês (pedido do Luiz, 01/10: "repetir só as parcelas em aberto —
      // o contador eu posso parar de pagar esse mês"). Sem parcela = campo em
      // branco, e campo em branco não vira meta ao salvar.
      for (const c of r.categories) {
        initial[c.categoryId] =
          c.currentTarget != null
            ? String(c.currentTarget)
            : c.currentInstallments > 0
              ? String(Math.round(c.currentInstallments * 100) / 100)
              : ''
      }
      setValues(initial)
    })
  }, [month, year])

  const filledCount = categories ? categories.filter((c) => isFilled(values[c.categoryId])).length : 0

  function updateValue(categoryId: string, v: string) {
    setValues((prev) => ({ ...prev, [categoryId]: v }))
  }

  async function saveAll() {
    if (!categories) return
    setSaving(true)
    try {
      // só grava quem realmente tem um número válido — categoria que ele
      // deixou em branco de propósito não vira meta de R$0 fake.
      const toSave = categories.filter((c) => isFilled(values[c.categoryId]))
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
            <button className={styles.confirmBtn} onClick={saveAll} disabled={saving || filledCount === 0}>
              {saving ? 'Salvando...' : `Salvar ${filledCount} ${filledCount === 1 ? 'categoria' : 'categorias'}`}
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
