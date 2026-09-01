import { useEffect, useState } from 'react'
import { X, Download } from 'lucide-react'
import { api, type BudgetSummary, type WealthOverview, type ProjectsSummary, type BudgetCategory } from '../lib/api'
import { currency } from '../lib/format'
import { ClientPieChart } from './ClientPieChart'
import styles from './MonthlySummaryModal.module.css'

const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** Agrega gasto por categoria-mãe pra alimentar a pizza e o "quem mais
 * gastou" — mesma função de Dashboard.tsx, duplicada aqui de propósito (é
 * pequena, não vale importar entre página e componente por isso). */
function spentByParent(categories: BudgetCategory[]) {
  const map = new Map<string, number>()
  for (const c of categories) {
    const key = c.parentName ?? 'Outras'
    map.set(key, (map.get(key) ?? 0) + c.spent)
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

/** Resumo do mês fechado — Orçamento + Patrimônio + Projetos (o que já tem
 * dado real pra cada um). Sem endpoint novo pra Orçamento/Patrimônio:
 * reaproveita budgetSummary + wealthOverview. Projetos ganhou suporte a
 * `month` em /projects-summary + `bestProjectThisMonth` computado no
 * backend, especificamente pra esse resumo. */
export function MonthlySummaryModal({ month, year, onClose }: { month: number; year: number; onClose: () => void }) {
  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [projects, setProjects] = useState<ProjectsSummary | null>(null)

  useEffect(() => {
    api.budgetSummary({ month, year }).then(setBudget)
    api.wealthOverview().then(setWealth)
    api.projectsSummary({ month, year }).then(setProjects)
  }, [month, year])

  function downloadPdf() {
    window.print()
  }

  const loading = !budget || !wealth || !projects
  const monthLabel = `${MONTH_NAMES_FULL[month - 1]} de ${year}`

  const essentialSpent = budget?.categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const nonEssentialSpent = budget?.categories.filter((c) => c.kind === 'non_essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const diffFromPlanned = budget ? budget.totalPlanned - budget.totalSpent : 0
  const withinBudget = diffFromPlanned >= 0

  const byParent = budget ? spentByParent(budget.categories) : []
  const pieData = byParent.filter((p) => p.value > 0)
  const topCategory = pieData[0] ?? null

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
            <p className={styles.printTitle}>Command OS — Resumo de {monthLabel}</p>

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

              {pieData.length > 0 ? (
                <>
                  <div className={styles.chartWrap}>
                    <ClientPieChart data={pieData} />
                  </div>
                  {topCategory && (
                    <p className={styles.highlight}>
                      Categoria que mais gastou: <strong>{topCategory.label}</strong> (R$ {currency(topCategory.value)})
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>Nenhum gasto categorizado em {monthLabel} ainda.</p>
              )}
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
                  <p className={styles.highlight}>
                    {bestMover ? (
                      <>
                        Investimento que mais rendeu: <strong>{bestMover.ticker}</strong> (+{bestMover.changePct.toFixed(1)}%)
                      </>
                    ) : (
                      'Nenhum ativo com alta este mês.'
                    )}
                  </p>
                </>
              ) : (
                <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Projetos</h4>
              {projects!.receivedThisMonth > 0 || projects!.bestProjectThisMonth ? (
                <>
                  <div className={styles.statGrid}>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>Recebido no mês</span>
                      <span className={styles.statValue}>R$ {currency(projects!.receivedThisMonth)}</span>
                    </div>
                  </div>
                  {projects!.bestProjectThisMonth && (
                    <p className={styles.highlight}>
                      Projeto que mais rendeu: <strong>{projects!.bestProjectThisMonth.name}</strong> (R${' '}
                      {currency(projects!.bestProjectThisMonth.received)})
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>Sem recebimento de projeto registrado em {monthLabel} ainda.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
