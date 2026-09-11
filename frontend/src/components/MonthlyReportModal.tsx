import { useEffect, useState } from 'react'
import { AlertTriangle, X, Download } from 'lucide-react'
import { api, type BudgetSummary, type WealthOverview, type ProjectsSummary, type BudgetCategory } from '../lib/api'
import { currency } from '../lib/format'
import { ClientPieChart } from './ClientPieChart'
import { MonthDelta } from './MonthDelta'
import { IconButton } from './IconButton'
import { InstallmentBadge } from './Badge'
import styles from './MonthlyReportModal.module.css'

const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Agrega gasto por categoria-mãe pra alimentar a pizza e o "quem mais
 * gastou" — mesma função de Dashboard.tsx, duplicada de propósito (pequena,
 * não vale importar só por isso). */
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

/** Conteúdo do relatório mensal, numa modal — pedido do Luiz (09/09): "pra não
 * me confundir, em configurações não precisa exibir as infos do relatório, só
 * deixe o mês, visualizar numa modal e baixar pdf". O controle de mês fica em
 * `MonthlyReport.tsx` (a seção fixa de Configurações); essa modal só recebe
 * `month`/`year` já resolvidos e mostra o conteúdo. `autoPrint` dispara
 * `window.print()` sozinho assim que os dados carregam — usado pelo botão
 * "Baixar PDF" do controle, que abre a modal já nesse modo. */
export function MonthlyReportModal({
  month,
  year,
  autoPrint,
  onClose,
}: {
  month: number
  year: number
  autoPrint?: boolean
  onClose: () => void
}) {
  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [projects, setProjects] = useState<ProjectsSummary | null>(null)
  const [printed, setPrinted] = useState(false)

  useEffect(() => {
    setBudget(null)
    setWealth(null)
    setProjects(null)
    api.budgetSummary({ month, year }).then(setBudget)
    api.wealthOverview({ month, year }).then(setWealth)
    api.projectsSummary({ month, year }).then(setProjects)
  }, [month, year])

  const loading = !budget || !wealth || !projects

  useEffect(() => {
    if (autoPrint && !loading && !printed) {
      setPrinted(true)
      window.print()
    }
  }, [autoPrint, loading, printed])

  function downloadPdf() {
    window.print()
  }

  const monthLabel = `${MONTH_NAMES_FULL[month - 1]} de ${year}`

  const essentialSpent = budget?.categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const nonEssentialSpent = budget?.categories.filter((c) => c.kind === 'non_essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const previousTotalSpent = budget?.categories.reduce((s, c) => s + c.previousSpent, 0) ?? 0
  const diffFromPlanned = budget ? budget.totalPlanned - budget.totalSpent : 0
  const withinBudget = diffFromPlanned >= 0

  const byParent = budget ? spentByParent(budget.categories) : []
  const pieData = byParent.filter((p) => p.value > 0)
  const topCategory = pieData[0] ?? null
  // Categoria que mais CRESCEU vs mês anterior (maior delta positivo) —
  // diferente de "quem mais gastou" (uma categoria pode ser sempre a maior
  // sem ter crescido nada esse mês).
  const fastestGrowingCategory = [...pieData]
    .map((p) => ({ ...p, delta: p.value - p.previousValue }))
    .filter((p) => p.previousValue > 0 && p.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0]

  // Categoria(s) que estourou(aram) o planejado — mesma regra de "over" usada
  // no Dashboard/Orçamento/modal de detalhamento (10/09: precisa ser global,
  // não só onde foi implementada primeiro), aqui aplicada ao relatório.
  const overBudgetCategories = (budget?.categories ?? [])
    .filter((c) => c.planned > 0 && c.spent > c.planned)
    .sort((a, b) => b.spent - b.planned - (a.spent - a.planned))
  const totalProjected = budget?.totalProjected ?? 0

  const bestMover = wealth?.movers.filter((m) => m.changePct > 0).sort((a, b) => b.changePct - a.changePct)[0] ?? null
  const allocationData = wealth?.allocation.filter((a) => a.value > 0) ?? []

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={`${styles.header} ${styles.noPrint}`}>
          <h3 className={styles.title}>Relatório de {monthLabel}</h3>
          <div className={styles.headerActions}>
            <button className={styles.pdfBtn} onClick={downloadPdf} disabled={loading}>
              <Download size={13} strokeWidth={2} />
              Baixar PDF
            </button>
            <IconButton onClick={onClose} aria-label="Fechar">
              <X size={16} strokeWidth={2} />
            </IconButton>
          </div>
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
                  {/* Mesma nota de "Onde meu dinheiro foi" em Orçamento (10/09)
                      — o total já inclui parcela projetada, precisa avisar
                      aqui também pra não parecer um número "de outro lugar". */}
                  {totalProjected > 0 && <span className={styles.projectedNote}>dos quais R$ {currency(totalProjected)} projetado</span>}
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

              {/* Estourou o planejado — só o ícone acusa (pedido do Luiz,
                  11/09: "deixa apenas o alerta em vermelho"), mesma marca
                  usada em toda a plataforma pra essa situação. */}
              {overBudgetCategories.length > 0 && (
                <p className={styles.highlight}>
                  <AlertTriangle size={12} strokeWidth={2} className={styles.overIcon} />
                  Estourou o planejado em: {overBudgetCategories.map((c) => `${c.name} (+R$ ${currency(c.spent - c.planned)})`).join(', ')}
                </p>
              )}

              {budget!.biggestPurchase && (
                <p className={styles.highlight}>
                  Maior compra: <strong>{budget!.biggestPurchase.description}</strong>
                  <InstallmentBadge number={budget!.biggestPurchase.installmentNumber} total={budget!.biggestPurchase.totalInstallments} />
                  {' — R$ '}
                  {currency(budget!.biggestPurchase.amount)}
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
    </div>
  )
}
