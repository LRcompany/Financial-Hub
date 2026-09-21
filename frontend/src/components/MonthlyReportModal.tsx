import { useEffect, useState, type ReactNode } from 'react'
import { Download, Sparkles, PieChart, Wallet, Briefcase, Flag } from 'lucide-react'
import type { ComponentType } from 'react'
import { api, type BudgetSummary, type WealthOverview, type ProjectsSummary, type BudgetCategory } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { ClientPieChart } from './ClientPieChart'
import { RankedBarList } from './RankedBarList'
import { SmoothLineChart } from './SmoothLineChart'
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

type IconType = ComponentType<{ size?: number; strokeWidth?: number }>

/** Caixa de uma seção do relatório (21/09, pedido do Luiz: "jogue orçamento,
 * patrimônio e projetos em boxes, assim dá pra diferenciar o que é cada") —
 * borda + título com ícone. Hierarquia: título da página (maior) > título do
 * box > subtítulo dentro do box (`SubBox`/`.subTitle`). */
function Box({ icon: Icon, title, children }: { icon?: IconType; title: string; children: ReactNode }) {
  return (
    <section className={styles.box}>
      <div className={styles.boxHeader}>
        {Icon && <Icon size={16} strokeWidth={2} />}
        <h4 className={styles.boxTitle}>{title}</h4>
      </div>
      {children}
    </section>
  )
}

/** Caixa menor DENTRO de um `Box` (ex: "Que mais renderam" x "Que mais
 * caíram") — separa blocos que antes ficavam colados um no outro. */
function SubBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.subBox}>
      <h5 className={styles.subTitle}>{title}</h5>
      {children}
    </div>
  )
}

/** Destaques no TOPO de cada página, fundo azul clarinho (`--accent-soft`,
 * pedido do Luiz: "os destaques que era pra ser destaque estão escondidos...
 * coloque no topo com um fundo azul clarinho"). Cada item = rótulo pequeno +
 * valor em negrito. Sem item nenhum, nem aparece. */
function Highlights({ items }: { items: { label: string; value: ReactNode }[] }) {
  if (items.length === 0) return null
  return (
    <section className={styles.highlights}>
      <div className={styles.boxHeader}>
        <Sparkles size={16} strokeWidth={2} />
        <h4 className={styles.boxTitle}>Destaques</h4>
      </div>
      <div className={styles.highlightGrid}>
        {items.map((it) => (
          <div key={it.label} className={styles.highlightItem}>
            <span className={styles.highlightLabel}>{it.label}</span>
            <span className={styles.highlightValue}>{it.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

const DIVIDEND_COLUMNS: { type: string; label: string }[] = [
  { type: 'FII', label: 'FIIs' },
  { type: 'Ação', label: 'Ações' },
  { type: 'Fundo', label: 'Fundos' },
]

/** Proventos do mês em colunas por tipo de ativo (pedido do Luiz: "uma
 * tabela com colunas, FIIs, ações, fundos"). Tipo fora dessas três (se
 * houver) vira "Outros" — nunca some valor. */
function DividendsTable({ rows }: { rows: { label: string; type: string; value: number }[] }) {
  const known = new Set(DIVIDEND_COLUMNS.map((c) => c.type))
  const columns = [
    ...DIVIDEND_COLUMNS.map((c) => ({ label: c.label, items: rows.filter((r) => r.type === c.type) })),
    { label: 'Outros', items: rows.filter((r) => !known.has(r.type)) },
  ].filter((c) => c.items.length > 0)
  const depth = Math.max(...columns.map((c) => c.items.length))
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${styles.dividendsTable}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: depth }, (_, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const it = c.items[i]
                return (
                  <td key={c.label}>
                    {it ? (
                      <span className={styles.dividendCell}>
                        <span>{it.label}</span>
                        <Money>{`R$ ${currency(it.value)}`}</Money>
                      </span>
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {columns.map((c) => (
              <td key={c.label}>
                <span className={styles.dividendCell}>
                  <strong>Total</strong>
                  <strong>
                    <Money>{`R$ ${currency(c.items.reduce((s, r) => s + r.value, 0))}`}</Money>
                  </strong>
                </span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function DayChips({ days, tone }: { days: { date: string; amount: number }[]; tone: 'under' | 'over' }) {
  if (days.length === 0) return <p className={styles.emptyNote}>Nenhum dia.</p>
  return (
    <div className={styles.dayChips}>
      {days.map((d) => (
        <span key={d.date} className={`${styles.dayChip} ${tone === 'under' ? styles.dayChipUnder : styles.dayChipOver}`}>
          <strong>{d.date.split('-')[2]}</strong>
          <Money>{`R$ ${currency(d.amount)}`}</Money>
        </span>
      ))}
    </div>
  )
}

/** Conteúdo do relatório mensal, numa modal com PÁGINAS: Resumo + uma por área.
 * Na tela, abas trocam a página; no PDF (`window.print()`) todas saem, cada
 * uma numa folha nova. Cada página = Destaques (azul clarinho) no topo + boxes
 * por assunto. `autoPrint` dispara `window.print()` assim que os dados
 * carregam — usado pelo botão "Baixar PDF" do controle. */
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
  // Dias abaixo x acima da meta (só dia com meta em vigor) — no lugar do
  // calendário (pedido do Luiz: "não precisa mostrar o calendário, mas podemos
  // mostrar apenas os dias que fiquei acima e abaixo").
  const daysUnder = dailyDays.filter((d) => d.goal != null && d.amount <= d.goal)
  const daysOver = dailyDays.filter((d) => d.goal != null && d.amount > d.goal)

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

  // ---------------- Destaques de cada página ----------------
  const dailyGoalItems = budget && budget.daysWithGoal > 0
    ? [
        { label: 'Dias abaixo da meta diária', value: `${budget.daysUnderGoal} de ${budget.daysWithGoal}` },
        ...(budget.dailyGoalSaved > 0 ? [{ label: 'Economizado na meta diária', value: <Money>R$ {currency(budget.dailyGoalSaved)}</Money> }] : []),
      ]
    : []
  const budgetHighlights = [
    ...(pieData[0] ? [{ label: 'Onde mais gastou', value: <>{pieData[0].label} · <Money>R$ {currency(pieData[0].value)}</Money></> }] : []),
    ...(fastestGrowingCategory
      ? [{ label: 'Categoria que mais cresceu', value: <>{fastestGrowingCategory.label} · <Money>+R$ {currency(fastestGrowingCategory.delta)}</Money></> }]
      : []),
    ...(overBudgetCategories.length > 0
      ? [{ label: 'Passou do estipulado', value: <>{overBudgetCategories.length} categoria{overBudgetCategories.length === 1 ? '' : 's'} <OverBudgetIcon /></> }]
      : []),
    ...(budget?.biggestPurchase
      ? [{ label: 'Maior compra', value: <>{budget.biggestPurchase.description} · <Money>R$ {currency(budget.biggestPurchase.amount)}</Money></> }]
      : []),
    ...dailyGoalItems,
  ]
  const wealthHighlights = [
    ...(topGainers[0] ? [{ label: 'Investimento que mais rendeu', value: `${topGainers[0].label} · +${topGainers[0].changePct.toFixed(1)}%` }] : []),
    ...(topLosers[0] ? [{ label: 'Investimento que mais caiu', value: `${topLosers[0].label} · ${topLosers[0].changePct.toFixed(1)}%` }] : []),
    ...(wealth?.dividendsThisMonth != null
      ? [{ label: 'Proventos recebidos', value: <Money>R$ {currency(wealth.dividendsThisMonth)}</Money> }]
      : []),
    ...(goalPct != null ? [{ label: 'Rumo ao primeiro milhão', value: `${goalPct.toFixed(1)}%` }] : []),
  ]
  const projectHighlights = [
    ...(projects && projects.receivedThisMonth > 0 ? [{ label: 'Recebido no mês', value: <Money>R$ {currency(projects.receivedThisMonth)}</Money> }] : []),
    ...(receivedPerDay != null && receivedPerDay > 0 ? [{ label: 'Ganho por dia trabalhado', value: <Money>R$ {currency(receivedPerDay)}</Money> }] : []),
    ...(projects?.bestProjectThisMonth
      ? [{ label: 'Projeto que mais rendeu', value: <>{projects.bestProjectThisMonth.name} · <Money>R$ {currency(projects.bestProjectThisMonth.received)}</Money></> }]
      : []),
    ...(projects && projects.deliveredThisMonth.length > 0 ? [{ label: 'Projetos entregues', value: projects.deliveredThisMonth.length }] : []),
    ...(projects && projects.startedThisMonth.length > 0 ? [{ label: 'Projetos que entraram', value: projects.startedThisMonth.length }] : []),
    ...(projects && projects.taxPaidThisMonth > 0 ? [{ label: 'Imposto pago no mês', value: <Money>R$ {currency(projects.taxPaidThisMonth)}</Money> }] : []),
  ]
  // Resumo: os destaques mais fortes de cada área, juntos, no topo.
  const summaryHighlights = [
    ...budgetHighlights.slice(0, 2),
    ...dailyGoalItems.slice(0, 1),
    ...wealthHighlights.slice(0, 3),
    ...projectHighlights.slice(0, 2),
  ]

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
            <h3 className={styles.pageTitle}>Resumo do mês</h3>
            <Highlights items={summaryHighlights} />

            <Box icon={PieChart} title="Orçamento">
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
              </div>
              {pieData.length > 0 && (
                <SubBox title="Onde mais gastei">
                  <RankedBarList data={pieData} max={5} />
                </SubBox>
              )}
            </Box>

            <Box icon={Wallet} title="Patrimônio">
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
                  </div>
                  {wealth!.evolution.length >= 2 && (
                    <SubBox title="Evolução do patrimônio">
                      <SmoothLineChart
                        values={wealth!.evolution.map((e) => e.value)}
                        labels={wealth!.evolution.map((e) => e.label)}
                        gradientId="reportSummaryWealth"
                        height={70}
                      />
                    </SubBox>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
              )}
            </Box>

            <Box icon={Briefcase} title="Projetos">
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
                </div>
              ) : (
                <p className={styles.emptyNote}>Sem movimento de projeto registrado em {monthLabel}.</p>
              )}
            </Box>
          </div>

          {/* =============== PÁGINA 2 — ORÇAMENTO =============== */}
          <div className={`${styles.page} ${page === 'orcamento' ? styles.pageActive : ''}`}>
            <h3 className={styles.pageTitle}>Orçamento</h3>
            <Highlights items={budgetHighlights} />

            <Box icon={PieChart} title="Números do mês">
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
                <p className={styles.note}>
                  Maior compra: <strong>{budget!.biggestPurchase.description}</strong>
                  <InstallmentBadge number={budget!.biggestPurchase.installmentNumber} total={budget!.biggestPurchase.totalInstallments} />
                  {' — '}
                  <Money>R$ {currency(budget!.biggestPurchase.amount)}</Money>
                  {budget!.biggestPurchase.category ? ` · ${budget!.biggestPurchase.category}` : ''} · {formatDate(budget!.biggestPurchase.date)}
                </p>
              )}
            </Box>

            <Box icon={PieChart} title="Onde gastei mais">
              {pieData.length > 0 ? (
                <div className={styles.twoCols}>
                  <ClientPieChart data={pieData} />
                  <RankedBarList data={pieData} />
                </div>
              ) : (
                <p className={styles.emptyNote}>Nenhum gasto categorizado em {monthLabel} ainda.</p>
              )}
            </Box>

            <Box icon={Flag} title="Meta diária de gasto">
              {budget!.daysWithGoal > 0 ? (
                <>
                  <div className={styles.statGrid}>
                    <Stat label="Dias abaixo da meta">{daysUnder.length}</Stat>
                    <Stat label="Dias acima da meta">{daysOver.length}</Stat>
                    <Stat
                      label="Economizado"
                      note={budget!.previousDailyGoalSaved > 0 && <MonthDelta current={budget!.dailyGoalSaved} previous={budget!.previousDailyGoalSaved} higherIsBetter />}
                    >
                      <Money>R$ {currency(budget!.dailyGoalSaved)}</Money>
                    </Stat>
                  </div>
                  {dailyDays.length >= 2 && (
                    <SubBox title="Gasto dia a dia">
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
                    </SubBox>
                  )}
                  <div className={styles.twoCols}>
                    <SubBox title={`Dias abaixo da meta (${daysUnder.length})`}>
                      <DayChips days={daysUnder} tone="under" />
                    </SubBox>
                    <SubBox title={`Dias acima da meta (${daysOver.length})`}>
                      <DayChips days={daysOver} tone="over" />
                    </SubBox>
                  </div>
                </>
              ) : (
                <p className={styles.emptyNote}>Nenhuma meta diária estava em vigor em {monthLabel}.</p>
              )}
            </Box>

            <Box icon={PieChart} title="Categorias: gasto x estipulado">
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
            </Box>
          </div>

          {/* =============== PÁGINA 3 — PATRIMÔNIO =============== */}
          <div className={`${styles.page} ${page === 'patrimonio' ? styles.pageActive : ''}`}>
            <h3 className={styles.pageTitle}>Patrimônio</h3>
            {wealth!.hasData ? (
              <>
                <Highlights items={wealthHighlights} />

                <Box icon={Wallet} title="Números do mês">
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
                </Box>

                {goalPct != null && goalTarget != null && (
                  <Box icon={Flag} title="Rumo ao primeiro milhão">
                    <div className={styles.goalRow}>
                      <strong>{goalPct.toFixed(1)}%</strong>
                      <span>
                        de <Money>R$ {currency(goalTarget)}</Money> · faltam <Money>R$ {currency(Math.max(0, goalTarget - (wealth!.total ?? 0)))}</Money>
                      </span>
                    </div>
                    <div className={styles.goalTrack}>
                      <div className={styles.goalFill} style={{ width: `${goalPct}%` }} />
                    </div>
                  </Box>
                )}

                {wealth!.evolution.length >= 2 && (
                  <Box icon={Wallet} title="Evolução do patrimônio">
                    <SmoothLineChart
                      values={wealth!.evolution.map((e) => e.value)}
                      labels={wealth!.evolution.map((e) => e.label)}
                      gradientId="reportWealthEvolution"
                      height={80}
                    />
                  </Box>
                )}

                {allocationData.length > 0 && (
                  <Box icon={PieChart} title="Composição da carteira">
                    <ClientPieChart data={allocationData} />
                  </Box>
                )}

                <Box icon={Wallet} title="Variação dos investimentos (mês contra mês)">
                  {wealth!.movers.length > 0 && (
                    <SubBox title="Por classe de ativo">
                      <ul className={styles.moverList}>
                        {[...wealth!.movers].sort((a, b) => b.changePct - a.changePct).map((m) => (
                          <li key={m.category} className={styles.moverRow}>
                            <span>{m.category}</span>
                            <PctChange pct={m.changePct} />
                          </li>
                        ))}
                      </ul>
                    </SubBox>
                  )}
                  <div className={styles.twoCols}>
                    <SubBox title="Que mais renderam">
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
                    </SubBox>
                    <SubBox title="Que mais caíram">
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
                    </SubBox>
                  </div>
                  <p className={styles.chartCaption}>
                    Variação já descontado o dinheiro novo que entrou — só valorização (ou queda) do que já estava investido.
                  </p>
                </Box>

                <Box icon={Wallet} title="Proventos recebidos no mês">
                  {wealth!.dividendsBreakdown.length > 0 ? (
                    <DividendsTable rows={wealth!.dividendsBreakdown} />
                  ) : (
                    <p className={styles.emptyNote}>Nenhum provento registrado em {monthLabel}.</p>
                  )}
                </Box>
              </>
            ) : (
              <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
            )}
          </div>

          {/* =============== PÁGINA 4 — PROJETOS =============== */}
          <div className={`${styles.page} ${page === 'projetos' ? styles.pageActive : ''}`}>
            <h3 className={styles.pageTitle}>Projetos</h3>
            <Highlights items={projectHighlights} />

            <Box icon={Briefcase} title="Números do mês">
              <div className={styles.statGrid}>
                <Stat
                  label="Recebido no mês"
                  note={projects!.receivedLastMonth > 0 && <MonthDelta current={projects!.receivedThisMonth} previous={projects!.receivedLastMonth} higherIsBetter />}
                >
                  <Money>R$ {currency(projects!.receivedThisMonth)}</Money>
                </Stat>
                <Stat label="Dias trabalhados no mês">{projects!.workedDaysThisMonth}</Stat>
                <Stat label="Ganho por dia trabalhado" note={<span className={styles.projectedNote}>só o que foi recebido no mês</span>}>
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
            </Box>

            <div className={styles.twoCols}>
              <Box icon={Briefcase} title="Projetos que entraram">
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
              </Box>
              <Box icon={Briefcase} title="Projetos entregues">
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
              </Box>
            </div>

            {projects!.monthlyReceived.length >= 2 && (
              <Box icon={Briefcase} title="Recebido por mês no ano">
                <SmoothLineChart
                  values={projects!.monthlyReceived.map((m) => m.value)}
                  labels={projects!.monthlyReceived.map((m) => m.label)}
                  gradientId="reportProjectsMonthly"
                  height={80}
                />
                <p className={styles.chartCaption}>
                  <Money>R$ {currency(projects!.receivedThisYear)}</Money> recebidos no ano · média de <Money>R$ {currency(projects!.avgMonthlyThisYear)}</Money> por mês
                </p>
              </Box>
            )}

            {projects!.clientRevenue.length > 0 && (
              <Box icon={PieChart} title="Receita por cliente no ano">
                <div className={styles.twoCols}>
                  <ClientPieChart data={projects!.clientRevenue} />
                  <RankedBarList data={projects!.clientRevenue} />
                </div>
              </Box>
            )}
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
