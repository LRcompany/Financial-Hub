import { useEffect, useState } from 'react'
import { X, Download } from 'lucide-react'
import { api, type BudgetSummary, type WealthOverview } from '../lib/api'
import { currency } from '../lib/format'
import styles from './MonthlySummaryModal.module.css'

const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** Resumo do mês fechado — só Orçamento + Patrimônio por enquanto (Projetos
 * ainda não tem "Entradas" real conectada, entra quando esse módulo for
 * remontado). Sem endpoint novo: reaproveita budgetSummary + wealthOverview,
 * que já calculam tudo que precisamos (inclusive o "destaque" de investimento
 * via wealth.movers). */
export function MonthlySummaryModal({ month, year, onClose }: { month: number; year: number; onClose: () => void }) {
  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [wealth, setWealth] = useState<WealthOverview | null>(null)

  useEffect(() => {
    api.budgetSummary({ month, year }).then(setBudget)
    api.wealthOverview().then(setWealth)
  }, [month, year])

  function downloadPdf() {
    window.print()
  }

  const loading = !budget || !wealth
  const monthLabel = `${MONTH_NAMES_FULL[month - 1]} de ${year}`

  const essentialSpent = budget?.categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const nonEssentialSpent = budget?.categories.filter((c) => c.kind === 'non_essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const diffFromPlanned = budget ? budget.totalPlanned - budget.totalSpent : 0
  const withinBudget = diffFromPlanned >= 0

  const bestMover = wealth?.movers.filter((m) => m.changePct > 0).sort((a, b) => b.changePct - a.changePct)[0] ?? null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={`${styles.header} ${styles.noPrint}`}>
          <h3 className={styles.title}>Resumo de {monthLabel}</h3>
          <div className={styles.headerActions}>
            <button className={styles.pdfBtn} onClick={downloadPdf} disabled={loading}>
              <Download size={13} strokeWidth={2} />
              Baixar PDF
            </button>
            <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {loading && <p className={styles.loading}>Carregando resumo...</p>}

        {!loading && (
          <div className={styles.content}>
            <p className={styles.printTitle}>Financial Hub — Resumo de {monthLabel}</p>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Orçamento</h4>
              <div className={styles.statGrid}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Total gasto</span>
                  <span className={styles.statValue}>R$ {currency(budget!.totalSpent)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Planejado</span>
                  <span className={styles.statValue}>R$ {currency(budget!.totalPlanned)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{withinBudget ? 'Sobrou' : 'Estourou'}</span>
                  <span className={`${styles.statValue} ${withinBudget ? styles.good : styles.bad}`}>
                    R$ {currency(Math.abs(diffFromPlanned))}
                  </span>
                </div>
              </div>
              <div className={styles.splitRow}>
                <span>Essencial: R$ {currency(essentialSpent)}</span>
                <span>Não essencial: R$ {currency(nonEssentialSpent)}</span>
              </div>
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Patrimônio</h4>
              {wealth!.hasData ? (
                <>
                  <div className={styles.statGrid}>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>Investido no mês</span>
                      <span className={styles.statValue}>
                        {wealth!.investedThisMonth != null ? `R$ ${currency(wealth!.investedThisMonth)}` : '—'}
                      </span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>Patrimônio total</span>
                      <span className={styles.statValue}>R$ {currency(wealth!.total ?? 0)}</span>
                    </div>
                  </div>
                  <div className={styles.splitRow}>
                    {bestMover ? (
                      <span>
                        Destaque do mês: <strong>{bestMover.ticker}</strong> (+{bestMover.changePct.toFixed(1)}%)
                      </span>
                    ) : (
                      <span>Nenhum ativo com alta este mês.</span>
                    )}
                  </div>
                </>
              ) : (
                <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
              )}
            </section>

            <p className={styles.footer}>Entradas e Projetos entram aqui quando esse módulo for remontado.</p>
          </div>
        )}
      </div>
    </div>
  )
}
