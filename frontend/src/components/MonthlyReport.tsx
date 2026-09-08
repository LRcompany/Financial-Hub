import { useEffect, useState } from 'react'
import { Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, type BudgetSummary, type WealthOverview, type ProjectsSummary, type BudgetCategory } from '../lib/api'
import { currency } from '../lib/format'
import { ClientPieChart } from './ClientPieChart'
import { MonthDelta } from './MonthDelta'
import styles from './MonthlyReport.module.css'

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Agrega gasto por categoria-mãe pra alimentar a pizza e o "quem mais
 * gastou" — mesma função de Dashboard.tsx/MonthlySummaryModal antigo,
 * duplicada de propósito (pequena, não vale importar só por isso). */
function spentByParent(categories: BudgetCategory[]) {
  const map = new Map<string, { spent: number; previousSpent: number }>()
  for (const c of categories) {
    const key = c.parentName ?? 'Outras'
    const existing = map.get(key) ?? { spent: 0, previousSpent: 0 }
    existing.spent += c.spent
    existing.previousSpent += c.previousSpent
    map.set(key, existing)
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, value: v.spent, previousValue: v.previousSpent }))
    .sort((a, b) => b.value - a.value)
}

/** Relatório mensal — pedido do Luiz (08/09): "o que você fez ficou muito
 * pobre... quero ver tudo que tem em orçamento, projeto e patrimônio, tudo
 * comparativo com o mês anterior". Antes era um modal disparado só pelo
 * Dashboard, travado no mês anterior, sem navegação (ver blueprint.md) —
 * virou uma seção fixa aqui em Configurações, com navegação livre de mês.
 * Sem LLM nenhum: tudo aqui é métrica pura (soma, ranking, delta % vs mês
 * anterior) — boa parte do dado comparativo já existia no backend
 * (previousSpent, previousTotal, receivedLastMonth...), só nunca tinha sido
 * usado nesse relatório. */
export function MonthlyReport() {
  const now = new Date()
  // Mês ANTERIOR como ponto de partida — é o mês "fechado" mais recente, o
  // mesmo padrão que o banner do Dashboard já usava antes.
  const initial = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [month, setMonth] = useState(initial.getMonth() + 1)
  const [year, setYear] = useState(initial.getFullYear())

  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [projects, setProjects] = useState<ProjectsSummary | null>(null)

  useEffect(() => {
    setBudget(null)
    setWealth(null)
    setProjects(null)
    api.budgetSummary({ month, year }).then(setBudget)
    api.wealthOverview({ month, year }).then(setWealth)
    api.projectsSummary({ month, year }).then(setProjects)
  }, [month, year])

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setMonth(m)
    setYear(y)
  }

  function downloadPdf() {
    window.print()
  }

  const loading = !budget || !wealth || !projects
  const monthLabel = `${MONTH_NAMES_FULL[month - 1]} de ${year}`

  const essentialSpent = budget?.categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const nonEssentialSpent = budget?.categories.filter((c) => c.kind === 'non_essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const previousTotalSpent = budget?.categories.reduce((s, c) => s + c.previousSpent, 0) ?? 0
  const diffFromPlanned = budget ? budget.totalPlanned - budget.totalSpent : 0
  const withinBudget = diffFromPlanned >= 0

  const byParent = budget ? spentByParent(budget.categories) : []
  const pieData = byParent.filter((p) => p.value > 0)
  const topCategory = pieData[0] ?? null
  // Categoria que mais CRESCEU vs mês anterior (maior delta positivo) — novo,
  // diferente de "quem mais gastou" (uma categoria pode ser sempre a maior
  // sem ter crescido nada esse mês).
  const fastestGrowingCategory = [...pieData]
    .map((p) => ({ ...p, delta: p.value - p.previousValue }))
    .filter((p) => p.previousValue > 0 && p.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0]

  const bestMover = wealth?.movers.filter((m) => m.changePct > 0).sort((a, b) => b.changePct - a.changePct)[0] ?? null
  const allocationData = wealth?.allocation.filter((a) => a.value > 0) ?? []

  return (
    <div className={styles.root}>
      <div className={`${styles.header} ${styles.noPrint}`}>
        <div className={styles.monthNav}>
          <button className={styles.navBtn} onClick={() => changeMonth(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <span className={styles.monthLabel}>
            {MONTH_NAMES[month - 1]}/{year}
          </span>
          <button className={styles.navBtn} onClick={() => changeMonth(1)} aria-label="Próximo mês">
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
        <button className={styles.pdfBtn} onClick={downloadPdf} disabled={loading}>
          <Download size={13} strokeWidth={2} />
          Baixar PDF
        </button>
      </div>

      {loading && <p className={styles.loading}>Carregando relatório...</p>}

      {!loading && (
        <div className={styles.content}>
          <p className={styles.printTitle}>Command OS — Relatório de {monthLabel}</p>

          {/* ---------- Orçamento ---------- */}
          <section className={styles.block}>
            <h4 className={styles.blockTitle}>Orçamento</h4>
            <div className={styles.statGrid}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Total gasto</span>
                <span className={styles.statValue}>R$ {currency(budget!.totalSpent)}</span>
                {previousTotalSpent > 0 && <MonthDelta current={budget!.totalSpent} previous={previousTotalSpent} higherIsBetter={false} />}
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Recebido</span>
                <span className={styles.statValue}>R$ {currency(budget!.totalIncome)}</span>
                {budget!.previousTotalIncome > 0 && (
                  <MonthDelta current={budget!.totalIncome} previous={budget!.previousTotalIncome} higherIsBetter />
                )}
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
                {fastestGrowingCategory && (
                  <p className={styles.highlight}>
                    Categoria que mais cresceu: <strong>{fastestGrowingCategory.label}</strong> (+R${' '}
                    {currency(fastestGrowingCategory.delta)} vs. mês anterior)
                  </p>
                )}
              </>
            ) : (
              <p className={styles.emptyNote}>Nenhum gasto categorizado em {monthLabel} ainda.</p>
            )}

            {budget!.biggestPurchase && (
              <p className={styles.highlight}>
                Maior compra: <strong>{budget!.biggestPurchase.description}</strong> — R$ {currency(budget!.biggestPurchase.amount)}
                {budget!.biggestPurchase.category ? ` · ${budget!.biggestPurchase.category}` : ''} · {formatDate(budget!.biggestPurchase.date)}
              </p>
            )}
          </section>

          {/* ---------- Patrimônio ---------- */}
          <section className={styles.block}>
            <h4 className={styles.blockTitle}>Patrimônio</h4>
            {wealth!.hasData ? (
              <>
                <div className={styles.statGrid}>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Patrimônio total</span>
                    <span className={styles.statValue}>R$ {currency(wealth!.total ?? 0)}</span>
                    {wealth!.previousTotal != null && wealth!.previousTotal > 0 && (
                      <MonthDelta current={wealth!.total ?? 0} previous={wealth!.previousTotal} higherIsBetter />
                    )}
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Investido no mês</span>
                    <span className={styles.statValue}>
                      {wealth!.investedThisMonth != null ? `R$ ${currency(wealth!.investedThisMonth)}` : '—'}
                    </span>
                    {wealth!.investedThisMonth != null && wealth!.investedLastMonth != null && wealth!.investedLastMonth > 0 && (
                      <MonthDelta current={wealth!.investedThisMonth} previous={wealth!.investedLastMonth} higherIsBetter />
                    )}
                  </div>
                </div>

                {allocationData.length > 0 && (
                  <div className={styles.chartWrap}>
                    <ClientPieChart data={allocationData} />
                  </div>
                )}

                <p className={styles.highlight}>
                  {bestMover ? (
                    <>
                      Categoria que mais rendeu: <strong>{bestMover.category}</strong> (+{bestMover.changePct.toFixed(1)}%)
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

          {/* ---------- Projetos ---------- */}
          <section className={styles.block}>
            <h4 className={styles.blockTitle}>Projetos</h4>
            {projects!.receivedThisMonth > 0 || projects!.bestProjectThisMonth || projects!.outstanding > 0 ? (
              <>
                <div className={styles.statGrid}>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Recebido no mês</span>
                    <span className={styles.statValue}>R$ {currency(projects!.receivedThisMonth)}</span>
                    {projects!.receivedLastMonth > 0 && (
                      <MonthDelta current={projects!.receivedThisMonth} previous={projects!.receivedLastMonth} higherIsBetter />
                    )}
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>A receber</span>
                    <span className={styles.statValue}>R$ {currency(projects!.outstanding)}</span>
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
  )
}
