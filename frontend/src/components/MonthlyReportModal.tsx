import { useEffect, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { api, type BudgetSummary, type WealthOverview, type ProjectsSummary, type BudgetCategory } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { ClientPieChart } from './ClientPieChart'
import { RankedBarList } from './RankedBarList'
import { SmoothLineChart } from './SmoothLineChart'
import { DailySpendCalendar } from './DailySpendCalendar'
import { MonthDelta } from './MonthDelta'
import { InstallmentBadge, ProjectedTag, OverBudgetIcon } from './Badge'
import { ModalShell } from './ModalShell'
import styles from './MonthlyReportModal.module.css'

const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

type PageId = 'resumo' | 'orcamento' | 'patrimonio' | 'projetos'
const PAGES: { id: PageId; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'orcamento', label: 'Orçamento' },
  { id: 'patrimonio', label: 'Patrimônio' },
  { id: 'projetos', label: 'Projetos' },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** "2026-08-21" -> "21 ago", sem passar por UTC (senão pode virar o dia anterior). */
function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Agrega gasto por categoria-mãe pra alimentar a pizza e o ranking. */
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

/** Categorias-folha agrupadas por categoria-mãe, com subtotal — pra tabela
 * "o que gastei em cada uma e o que passou do estipulado". Só entra folha com
 * meta OU gasto no mês (linha zerada dos dois lados é ruído). */
function groupedCategories(categories: BudgetCategory[]) {
  const groups = new Map<string, { name: string; spent: number; planned: number; rows: BudgetCategory[] }>()
  for (const c of categories) {
    if (c.spent <= 0 && c.planned <= 0) continue
    const key = c.parentName ?? 'Outras'
    const g = groups.get(key) ?? { name: key, spent: 0, planned: 0, rows: [] }
    g.spent += c.spent
    g.planned += c.planned
    g.rows.push(c)
    groups.set(key, g)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => b.spent - a.spent) }))
    .sort((a, b) => b.spent - a.spent)
}

/** Variação em % (já calculada) no mesmo formato de seta do resto do app —
 * `MonthDelta` compara dois valores, então 100+pct contra 100 dá o mesmo pct. */
function PctChange({ pct }: { pct: number }) {
  return <MonthDelta current={100 + pct} previous={100} higherIsBetter compact />
}

function Stat({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{children}</span>
      {note}
    </div>
  )
}

/** Conteúdo do relatório mensal, numa modal com PÁGINAS (21/09, pedido do
 * Luiz: "crie várias páginas se necessário. A primeira página é um resumo, e
 * as outras páginas serão para cada área: Orçamento, Patrimônio e
 * Projetos"). Na tela, abas trocam a página; no PDF (`window.print()`) todas
 * as páginas saem, cada uma começando numa folha nova. `autoPrint` dispara
 * `window.print()` sozinho assim que os dados carregam — usado pelo botão
 * "Baixar PDF" do controle. */
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
  const [page, setPage] = useState<PageId>('resumo')

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

  const monthLabel = `${MONTH_NAMES_FULL[month - 1]} de ${year}`

  // ---------------- Orçamento ----------------
  const essentialSpent = budget?.categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const nonEssentialSpent = budget?.categories.filter((c) => c.kind === 'non_essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const previousTotalSpent = budget?.categories.reduce((s, c) => s + c.previousSpent, 0) ?? 0
  const diffFromPlanned = budget ? budget.totalPlanned - budget.totalSpent : 0
  const withinBudget = diffFromPlanned >= 0
  const byParent = budget ? spentByParent(budget.categories) : []
  const pieData = byParent.filter((p) => p.value > 0)
  const fastestGrowingCategory = [...pieData]
    .map((p) => ({ ...p, delta: p.value - p.previousValue }))
    .filter((p) => p.previousValue > 0 && p.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0]
  // Mesma regra de "estourou" de todo o app: `spent > planned`, nunca
  // `planned > 0 && ...` (meta zerada com gasto real também é estouro).
  const overBudgetCategories = (budget?.categories ?? [])
    .filter((c) => c.spent > c.planned)
    .sort((a, b) => b.spent - b.planned - (a.spent - a.planned))
  const totalProjected = budget?.totalProjected ?? 0
  const groups = budget ? groupedCategories(budget.categories) : []
  const dailyDays = budget?.dailyDaysForPeriod ?? []
  const daysAvgSpend = dailyDays.length > 0 ? dailyDays.reduce((s, d) => s + d.amount, 0) / dailyDays.length : 0

  // ---------------- Patrimônio ----------------
  const allocationData = wealth?.allocation.filter((a) => a.value > 0) ?? []
  const positionMovers = wealth?.positionMovers ?? []
  const topGainers = positionMovers.filter((m) => m.changePct > 0).slice(0, 5)
  const topLosers = [...positionMovers].filter((m) => m.changePct < 0).reverse().slice(0, 5)
  const goalTarget = wealth?.wealthGoal?.targetAmount ?? null
  const goalPct = goalTarget && goalTarget > 0 && wealth?.total != null ? Math.min((wealth.total / goalTarget) * 100, 100) : null

  // ---------------- Projetos ----------------
  const receivedPerDay =
    projects && projects.workedDaysThisMonth > 0 ? projects.receivedThisMonth / projects.workedDaysThisMonth : null
  const hasProjectsData =
    !!projects &&
    (projects.receivedThisMonth > 0 ||
      projects.outstanding > 0 ||
      projects.deliveredThisMonth.length > 0 ||
      projects.startedThisMonth.length > 0 ||
      projects.taxPaidThisMonth > 0)

  return (
    <ModalShell
      title={<span className={styles.reportTitle}>Relatório de {monthLabel}</span>}
      headerActions={
        <button className={styles.pdfBtn} onClick={() => window.print()} disabled={loading}>
          <Download size={13} strokeWidth={2} />
          Baixar PDF
        </button>
      }
      printable
      maxWidth={860}
      onClose={onClose}
    >
      {loading && <p className={styles.loading}>Carregando relatório...</p>}

      {!loading && (
        <>
          <p className={styles.printTitle}>Command OS — Relatório de {monthLabel}</p>

          {/* Abas de página — só na tela; no PDF todas as páginas saem. */}
          <div className={styles.tabs} role="tablist">
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={page === p.id}
                className={`${styles.tab} ${page === p.id ? styles.tabActive : ''}`}
                onClick={() => setPage(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* =============== PÁGINA 1 — RESUMO =============== */}
          <div className={`${styles.page} ${page === 'resumo' ? styles.pageActive : ''}`}>
            <h4 className={styles.pageTitle}>Resumo do mês</h4>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Orçamento</h4>
              <div className={styles.statGrid}>
                <Stat
                  label="Total gasto"
                  note={previousTotalSpent > 0 && <MonthDelta current={budget!.totalSpent} previous={previousTotalSpent} higherIsBetter={false} />}
                >
                  <Money>R$ {currency(budget!.totalSpent)}</Money>
                </Stat>
                <Stat
                  label="Recebido"
                  note={budget!.previousTotalIncome > 0 && <MonthDelta current={budget!.totalIncome} previous={budget!.previousTotalIncome} higherIsBetter />}
                >
                  <Money>R$ {currency(budget!.totalIncome)}</Money>
                </Stat>
                <Stat label={withinBudget ? 'Sobrou do planejado' : 'Estourou o planejado'}>
                  <Money>R$ {currency(Math.abs(diffFromPlanned))}</Money>
                  {!withinBudget && <OverBudgetIcon />}
                </Stat>
                {budget!.daysWithGoal > 0 && (
                  <Stat label="Dias abaixo da meta diária" note={budget!.dailyGoalSaved > 0 && <span className={styles.projectedNote}>economizou <Money>R$ {currency(budget!.dailyGoalSaved)}</Money></span>}>
                    {budget!.daysUnderGoal} de {budget!.daysWithGoal}
                  </Stat>
                )}
              </div>
              {pieData.length > 0 && (
                <div className={styles.chartWrap}>
                  <RankedBarList data={pieData} max={5} />
                </div>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Patrimônio</h4>
              {wealth!.hasData ? (
                <>
                  <div className={styles.statGrid}>
                    <Stat
                      label="Patrimônio total"
                      note={wealth!.previousTotal != null && wealth!.previousTotal > 0 && <MonthDelta current={wealth!.total ?? 0} previous={wealth!.previousTotal} higherIsBetter />}
                    >
                      <Money>R$ {currency(wealth!.total ?? 0)}</Money>
                    </Stat>
                    <Stat label="Investido no mês">
                      {wealth!.investedThisMonth != null ? <Money>{`R$ ${currency(wealth!.investedThisMonth)}`}</Money> : '—'}
                    </Stat>
                    <Stat label="Proventos no mês">
                      {wealth!.dividendsThisMonth != null ? <Money>{`R$ ${currency(wealth!.dividendsThisMonth)}`}</Money> : '—'}
                    </Stat>
                    {goalPct != null && <Stat label="Rumo ao primeiro milhão">{goalPct.toFixed(1)}%</Stat>}
                  </div>
                  {wealth!.evolution.length >= 2 && (
                    <div className={styles.chartWrap}>
                      <SmoothLineChart
                        values={wealth!.evolution.map((e) => e.value)}
                        labels={wealth!.evolution.map((e) => e.label)}
                        gradientId="reportSummaryWealth"
                        height={70}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Projetos</h4>
              {hasProjectsData ? (
                <div className={styles.statGrid}>
                  <Stat
                    label="Recebido no mês"
                    note={projects!.receivedLastMonth > 0 && <MonthDelta current={projects!.receivedThisMonth} previous={projects!.receivedLastMonth} higherIsBetter />}
                  >
                    <Money>R$ {currency(projects!.receivedThisMonth)}</Money>
                  </Stat>
                  <Stat label="Ganho por dia trabalhado">
                    {receivedPerDay != null ? <Money>{`R$ ${currency(receivedPerDay)}`}</Money> : '—'}
                  </Stat>
                  <Stat label="Projetos entregues">{projects!.deliveredThisMonth.length}</Stat>
                  <Stat label="Imposto pago no mês">
                    <Money>R$ {currency(projects!.taxPaidThisMonth)}</Money>
                  </Stat>
                </div>
              ) : (
                <p className={styles.emptyNote}>Sem movimento de projeto registrado em {monthLabel}.</p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Destaques</h4>
              {pieData[0] && (
                <p className={styles.highlight}>
                  Onde mais gastou: <strong>{pieData[0].label}</strong> (<Money>R$ {currency(pieData[0].value)}</Money>)
                </p>
              )}
              {overBudgetCategories.length > 0 && (
                <p className={styles.highlight}>
                  {overBudgetCategories.length} categoria{overBudgetCategories.length === 1 ? '' : 's'} passou do valor estipulado <OverBudgetIcon />
                </p>
              )}
              {topGainers[0] && (
                <p className={styles.highlight}>
                  Investimento que mais rendeu: <strong>{topGainers[0].label}</strong> (+{topGainers[0].changePct.toFixed(1)}%)
                </p>
              )}
              {topLosers[0] && (
                <p className={styles.highlight}>
                  Investimento que mais caiu: <strong>{topLosers[0].label}</strong> ({topLosers[0].changePct.toFixed(1)}%)
                </p>
              )}
              {projects!.bestProjectThisMonth && (
                <p className={styles.highlight}>
                  Projeto que mais rendeu: <strong>{projects!.bestProjectThisMonth.name}</strong> (<Money>R$ {currency(projects!.bestProjectThisMonth.received)}</Money>)
                </p>
              )}
            </section>
          </div>

          {/* =============== PÁGINA 2 — ORÇAMENTO =============== */}
          <div className={`${styles.page} ${page === 'orcamento' ? styles.pageActive : ''}`}>
            <h4 className={styles.pageTitle}>Orçamento</h4>

            <section className={styles.block}>
              <div className={styles.statGrid}>
                <Stat
                  label="Total gasto"
                  note={
                    <>
                      {totalProjected > 0 && (
                        <span className={styles.projectedNote}>
                          dos quais <Money>R$ {currency(totalProjected)}</Money> <ProjectedTag />
                        </span>
                      )}
                      {previousTotalSpent > 0 && <MonthDelta current={budget!.totalSpent} previous={previousTotalSpent} higherIsBetter={false} />}
                    </>
                  }
                >
                  <Money>R$ {currency(budget!.totalSpent)}</Money>
                </Stat>
                <Stat label="Planejado">
                  <Money>R$ {currency(budget!.totalPlanned)}</Money>
                </Stat>
                <Stat label={withinBudget ? 'Sobrou' : 'Estourou'}>
                  <Money>R$ {currency(Math.abs(diffFromPlanned))}</Money>
                  {!withinBudget && <OverBudgetIcon />}
                </Stat>
              </div>
              <div className={styles.splitRow}>
                <span>Essencial: <Money>R$ {currency(essentialSpent)}</Money></span>
                <span>Não essencial: <Money>R$ {currency(nonEssentialSpent)}</Money></span>
              </div>
              {budget!.biggestPurchase && (
                <p className={styles.highlight}>
                  Maior compra: <strong>{budget!.biggestPurchase.description}</strong>
                  <InstallmentBadge number={budget!.biggestPurchase.installmentNumber} total={budget!.biggestPurchase.totalInstallments} />
                  {' — '}
                  <Money>R$ {currency(budget!.biggestPurchase.amount)}</Money>
                  {budget!.biggestPurchase.category ? ` · ${budget!.biggestPurchase.category}` : ''} · {formatDate(budget!.biggestPurchase.date)}
                </p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Onde gastei mais</h4>
              {pieData.length > 0 ? (
                <div className={styles.twoCols}>
                  <ClientPieChart data={pieData} />
                  <RankedBarList data={pieData} />
                </div>
              ) : (
                <p className={styles.emptyNote}>Nenhum gasto categorizado em {monthLabel} ainda.</p>
              )}
              {fastestGrowingCategory && (
                <p className={styles.highlight}>
                  Categoria que mais cresceu: <strong>{fastestGrowingCategory.label}</strong> (
                  <Money>+R$ {currency(fastestGrowingCategory.delta)}</Money> vs. mês anterior)
                </p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Gasto diário e meta</h4>
              {budget!.daysWithGoal > 0 ? (
                <p className={styles.highlight} style={{ marginTop: 0 }}>
                  <strong>
                    {budget!.daysUnderGoal} de {budget!.daysWithGoal} dia{budget!.daysWithGoal === 1 ? '' : 's'} abaixo da meta diária
                  </strong>
                  {budget!.dailyGoalSaved > 0 && (
                    <>
                      {' '}— <Money>R$ {currency(budget!.dailyGoalSaved)}</Money> economizados
                      {budget!.previousDailyGoalSaved > 0 && (
                        <MonthDelta current={budget!.dailyGoalSaved} previous={budget!.previousDailyGoalSaved} higherIsBetter />
                      )}
                    </>
                  )}
                </p>
              ) : (
                <p className={styles.emptyNote}>Nenhuma meta diária estava em vigor em {monthLabel}.</p>
              )}
              {dailyDays.length >= 2 && (
                <>
                  <div className={styles.chartWrap}>
                    <SmoothLineChart
                      values={dailyDays.map((d) => d.amount)}
                      labels={dailyDays.map((d) => formatDayLabel(d.date))}
                      threshold={dailyDays.find((d) => d.goal != null)?.goal ?? undefined}
                      gradientId="reportDailySpend"
                      breakdowns={dailyDays.map((d) => d.breakdown)}
                    />
                    <p className={styles.chartCaption}>
                      Média de <Money>R$ {currency(daysAvgSpend)}</Money> por dia · linha tracejada = meta diária
                    </p>
                  </div>
                  <div className={styles.calendarWrap}>
                    <DailySpendCalendar days={dailyDays} />
                  </div>
                </>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Categorias: gasto x estipulado</h4>
              {groups.length > 0 ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Categoria</th>
                        <th>Gasto</th>
                        <th>Estipulado</th>
                        <th>Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <GroupRows key={g.name} group={g} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.emptyNote}>Sem categoria com meta ou gasto em {monthLabel}.</p>
              )}
              {overBudgetCategories.length > 0 && (
                <p className={styles.highlight}>
                  Passou do valor estipulado em {overBudgetCategories.length} categoria{overBudgetCategories.length === 1 ? '' : 's'}, destaque para{' '}
                  {overBudgetCategories.slice(0, 3).map((c, i) => (
                    <span key={c.categoryId}>
                      {i > 0 && ', '}
                      <strong>{c.name}</strong> (<Money>+R$ {currency(c.spent - c.planned)}</Money>)
                    </span>
                  ))}
                  <OverBudgetIcon />
                </p>
              )}
            </section>
          </div>

          {/* =============== PÁGINA 3 — PATRIMÔNIO =============== */}
          <div className={`${styles.page} ${page === 'patrimonio' ? styles.pageActive : ''}`}>
            <h4 className={styles.pageTitle}>Patrimônio</h4>
            {wealth!.hasData ? (
              <>
                <section className={styles.block}>
                  <div className={styles.statGrid}>
                    <Stat
                      label="Patrimônio total"
                      note={wealth!.previousTotal != null && wealth!.previousTotal > 0 && <MonthDelta current={wealth!.total ?? 0} previous={wealth!.previousTotal} higherIsBetter />}
                    >
                      <Money>R$ {currency(wealth!.total ?? 0)}</Money>
                    </Stat>
                    <Stat
                      label="Investido no mês"
                      note={wealth!.investedThisMonth != null && wealth!.investedLastMonth != null && wealth!.investedLastMonth > 0 && <MonthDelta current={wealth!.investedThisMonth} previous={wealth!.investedLastMonth} higherIsBetter />}
                    >
                      {wealth!.investedThisMonth != null ? <Money>{`R$ ${currency(wealth!.investedThisMonth)}`}</Money> : '—'}
                    </Stat>
                    <Stat
                      label="Proventos no mês"
                      note={wealth!.dividendsThisMonth != null && wealth!.dividendsLastMonth != null && wealth!.dividendsLastMonth > 0 && <MonthDelta current={wealth!.dividendsThisMonth} previous={wealth!.dividendsLastMonth} higherIsBetter />}
                    >
                      {wealth!.dividendsThisMonth != null ? <Money>{`R$ ${currency(wealth!.dividendsThisMonth)}`}</Money> : '—'}
                    </Stat>
                  </div>
                </section>

                {goalPct != null && goalTarget != null && (
                  <section className={styles.block}>
                    <h4 className={styles.blockTitle}>Rumo ao primeiro milhão</h4>
                    <div className={styles.goalRow}>
                      <strong>{goalPct.toFixed(1)}%</strong>
                      <span>
                        de <Money>R$ {currency(goalTarget)}</Money> · faltam <Money>R$ {currency(Math.max(0, goalTarget - (wealth!.total ?? 0)))}</Money>
                      </span>
                    </div>
                    <div className={styles.goalTrack}>
                      <div className={styles.goalFill} style={{ width: `${goalPct}%` }} />
                    </div>
                  </section>
                )}

                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>Evolução e composição</h4>
                  {wealth!.evolution.length >= 2 && (
                    <div className={styles.chartWrap}>
                      <SmoothLineChart
                        values={wealth!.evolution.map((e) => e.value)}
                        labels={wealth!.evolution.map((e) => e.label)}
                        gradientId="reportWealthEvolution"
                        height={80}
                      />
                    </div>
                  )}
                  {allocationData.length > 0 && (
                    <div className={styles.chartWrap}>
                      <ClientPieChart data={allocationData} />
                    </div>
                  )}
                </section>

                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>Variação dos investimentos (mês contra mês)</h4>
                  {wealth!.movers.length > 0 && (
                    <>
                      <h5 className={styles.subBlockTitle}>Por classe de ativo</h5>
                      <ul className={styles.moverList}>
                        {[...wealth!.movers].sort((a, b) => b.changePct - a.changePct).map((m) => (
                          <li key={m.category} className={styles.moverRow}>
                            <span>{m.category}</span>
                            <PctChange pct={m.changePct} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className={styles.twoCols}>
                    <div>
                      <h5 className={styles.subBlockTitle}>Que mais renderam</h5>
                      {topGainers.length > 0 ? (
                        <ul className={styles.moverList}>
                          {topGainers.map((m) => (
                            <li key={`${m.type}-${m.label}`} className={styles.moverRow}>
                              <span>
                                {m.label} <span className={styles.moverType}>{m.type}</span>
                              </span>
                              <PctChange pct={m.changePct} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.emptyNote}>Nenhum ativo com alta este mês.</p>
                      )}
                    </div>
                    <div>
                      <h5 className={styles.subBlockTitle}>Que mais caíram</h5>
                      {topLosers.length > 0 ? (
                        <ul className={styles.moverList}>
                          {topLosers.map((m) => (
                            <li key={`${m.type}-${m.label}`} className={styles.moverRow}>
                              <span>
                                {m.label} <span className={styles.moverType}>{m.type}</span>
                              </span>
                              <PctChange pct={m.changePct} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.emptyNote}>Nenhum ativo caiu este mês.</p>
                      )}
                    </div>
                  </div>
                  <p className={styles.chartCaption}>
                    Variação já descontado o dinheiro novo que entrou — só valorização (ou queda) do que já estava investido.
                  </p>
                </section>

                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>Proventos recebidos</h4>
                  {wealth!.dividendsBreakdown.length > 0 ? (
                    <>
                      <p className={styles.highlight} style={{ marginTop: 0 }}>
                        Total no mês: <strong><Money>R$ {currency(wealth!.dividendsThisMonth ?? 0)}</Money></strong>
                        {wealth!.dividendsLastMonth != null && wealth!.dividendsLastMonth > 0 && (
                          <MonthDelta current={wealth!.dividendsThisMonth ?? 0} previous={wealth!.dividendsLastMonth} higherIsBetter />
                        )}
                      </p>
                      <div className={styles.chartWrap}>
                        <RankedBarList data={wealth!.dividendsBreakdown.map((d) => ({ label: d.label, value: d.value }))} />
                      </div>
                    </>
                  ) : (
                    <p className={styles.emptyNote}>Nenhum provento registrado em {monthLabel}.</p>
                  )}
                </section>
              </>
            ) : (
              <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
            )}
          </div>

          {/* =============== PÁGINA 4 — PROJETOS =============== */}
          <div className={`${styles.page} ${page === 'projetos' ? styles.pageActive : ''}`}>
            <h4 className={styles.pageTitle}>Projetos</h4>
            <section className={styles.block}>
              <div className={styles.statGrid}>
                <Stat
                  label="Recebido no mês"
                  note={projects!.receivedLastMonth > 0 && <MonthDelta current={projects!.receivedThisMonth} previous={projects!.receivedLastMonth} higherIsBetter />}
                >
                  <Money>R$ {currency(projects!.receivedThisMonth)}</Money>
                </Stat>
                <Stat label="Dias trabalhados no mês">{projects!.workedDaysThisMonth}</Stat>
                <Stat
                  label="Ganho por dia trabalhado"
                  note={<span className={styles.projectedNote}>só o que foi recebido no mês</span>}
                >
                  {receivedPerDay != null ? <Money>{`R$ ${currency(receivedPerDay)}`}</Money> : '—'}
                </Stat>
                <Stat label="A receber">
                  <Money>R$ {currency(projects!.outstanding)}</Money>
                </Stat>
                <Stat label="Imposto pago no mês">
                  <Money>R$ {currency(projects!.taxPaidThisMonth)}</Money>
                </Stat>
                <Stat label="Entregues / entraram">
                  {projects!.deliveredThisMonth.length} / {projects!.startedThisMonth.length}
                </Stat>
              </div>
              {projects!.bestProjectThisMonth && (
                <p className={styles.highlight}>
                  Projeto que mais rendeu: <strong>{projects!.bestProjectThisMonth.name}</strong> (
                  <Money>R$ {currency(projects!.bestProjectThisMonth.received)}</Money>)
                </p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Projetos que entraram</h4>
              {projects!.startedThisMonth.length > 0 ? (
                <ul className={styles.deliveredList}>
                  {projects!.startedThisMonth.map((p) => (
                    <li key={p.id} className={styles.deliveredRow}>
                      <span>
                        <strong>{p.name}</strong> · {p.client} · {formatDate(p.startDate)}
                      </span>
                      <span>
                        <Money>R$ {currency(p.contractValue)}</Money>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyNote}>Nenhum projeto novo começou em {monthLabel}.</p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Projetos entregues</h4>
              {projects!.deliveredThisMonth.length > 0 ? (
                <ul className={styles.deliveredList}>
                  {projects!.deliveredThisMonth.map((p) => (
                    <li key={p.id} className={styles.deliveredRow}>
                      <span>
                        <strong>{p.name}</strong> · {p.client} · {formatDate(p.deliveryDate)}
                      </span>
                      <span>
                        <Money>R$ {currency(p.contractValue)}</Money>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyNote}>Nenhum projeto fechou o pagamento em {monthLabel}.</p>
              )}
            </section>

            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Visão geral do ano</h4>
              {projects!.monthlyReceived.length >= 2 && (
                <div className={styles.chartWrap}>
                  <h5 className={styles.subBlockTitle}>Recebido por mês</h5>
                  <SmoothLineChart
                    values={projects!.monthlyReceived.map((m) => m.value)}
                    labels={projects!.monthlyReceived.map((m) => m.label)}
                    gradientId="reportProjectsMonthly"
                    height={80}
                  />
                </div>
              )}
              {projects!.clientRevenue.length > 0 && (
                <div className={styles.chartWrap}>
                  <h5 className={styles.subBlockTitle}>Receita por cliente no ano</h5>
                  <div className={styles.twoCols}>
                    <ClientPieChart data={projects!.clientRevenue} />
                    <RankedBarList data={projects!.clientRevenue} />
                  </div>
                </div>
              )}
              <p className={styles.chartCaption}>
                <Money>R$ {currency(projects!.receivedThisYear)}</Money> recebidos no ano · média de <Money>R$ {currency(projects!.avgMonthlyThisYear)}</Money> por mês
              </p>
            </section>
          </div>
        </>
      )}
    </ModalShell>
  )
}

/** Linhas de um grupo-mãe na tabela de categorias: subtotal em destaque +
 * folhas. `Diferença` = estipulado - gasto (negativo = passou), com o ícone de
 * alerta padrão só quando estourou (nunca cor no número). */
function GroupRows({ group }: { group: { name: string; spent: number; planned: number; rows: BudgetCategory[] } }) {
  return (
    <>
      <tr className={styles.groupRow}>
        <td>{group.name}</td>
        <td><Money>R$ {currency(group.spent)}</Money></td>
        <td><Money>R$ {currency(group.planned)}</Money></td>
        <DiffCell planned={group.planned} spent={group.spent} />
      </tr>
      {group.rows.map((c) => (
        <tr key={c.categoryId} className={styles.leafRow}>
          <td>
            {c.name} {c.spentProjected > 0 && <ProjectedTag />}
          </td>
          <td><Money>R$ {currency(c.spent)}</Money></td>
          <td>{c.planned > 0 ? <Money>R$ {currency(c.planned)}</Money> : '—'}</td>
          <DiffCell planned={c.planned} spent={c.spent} />
        </tr>
      ))}
    </>
  )
}

function DiffCell({ planned, spent }: { planned: number; spent: number }) {
  const over = spent > planned
  return (
    <td>
      <Money>{`${over ? '-' : ''}R$ ${currency(Math.abs(planned - spent))}`}</Money>
      {over && <OverBudgetIcon />}
    </td>
  )
}
