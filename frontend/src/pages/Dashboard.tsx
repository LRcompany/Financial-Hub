import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Target,
  Flag,
  PieChart,
  Receipt,
  LineChart,
  Coins,
  Activity,
  Briefcase,
} from 'lucide-react'
import {
  api,
  type Transaction,
  type BudgetSummary,
  type WealthOverview,
  type ProjectsSummary,
} from '../lib/api'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { MonthDelta } from '../components/MonthDelta'
import { ClientPieChart } from '../components/ClientPieChart'
import styles from './Dashboard.module.css'

/** "2026-08-21" -> "21 ago", sem risco de virar o dia anterior por fuso (não passa por UTC). */
function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function currency(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

function CardHeader({
  icon: Icon,
  title,
  href,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  title: string
  href?: string
}) {
  return (
    <div className={styles.cardHeader}>
      <div className={styles.cardHeaderLeft}>
        <Icon size={16} strokeWidth={2} />
        <h2 className={styles.cardTitle}>{title}</h2>
      </div>
      {href && (
        <a className={styles.cardLink} href={href}>
          Ver tudo
        </a>
      )}
    </div>
  )
}

export function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[] | null>(null)
  const [transactionsError, setTransactionsError] = useState(false)

  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [budgetError, setBudgetError] = useState(false)

  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [wealthError, setWealthError] = useState(false)

  const [projects, setProjects] = useState<ProjectsSummary | null>(null)
  const [projectsError, setProjectsError] = useState(false)

  useEffect(() => {
    const now = new Date()
    api
      .transactions({ month: now.getMonth() + 1, year: now.getFullYear() })
      .then((data) => setTransactions(data.slice(0, 5)))
      .catch(() => setTransactionsError(true))

    api.budgetSummary().then(setBudget).catch(() => setBudgetError(true))
    api.wealthOverview().then(setWealth).catch(() => setWealthError(true))
    api.projectsSummary().then(setProjects).catch(() => setProjectsError(true))
  }, [])

  const today = budget?.last14Days[budget.last14Days.length - 1]?.amount ?? 0
  const diff = budget?.dailyGoal != null ? budget.dailyGoal - today : null

  const wealthGoal = wealth?.wealthGoal ?? null
  const wealthTotal = wealth?.total ?? 0
  const goalProgress = wealthGoal ? Math.min((wealthTotal / wealthGoal.targetAmount) * 100, 100) : 0

  return (
    <div className={styles.page}>
      {/* ---------- Dia a dia ---------- */}
      <section>
        <h1 className={styles.sectionTitle}>Dia a dia</h1>
        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.fullWidth}`}>
            <CardHeader icon={Target} title="Meta diária de gasto" />

            {budgetError && <div className={styles.emptyState}>Não consegui falar com o backend ainda.</div>}

            {!budgetError && budget && (
              <>
                <div className={styles.dailyGoalTop}>
                  <div>
                    <div className={styles.heroLabel}>Gasto de hoje</div>
                    <div className={styles.heroValue}>R$ {currency(today)}</div>
                  </div>
                  <div className={styles.dailyGoalMeta}>
                    <span className={styles.heroLabel}>Meta diária</span>
                    <span style={{ fontWeight: 600 }}>
                      {budget.dailyGoal != null ? `R$ ${budget.dailyGoal.toLocaleString('pt-BR')}` : 'não definida'}
                    </span>
                  </div>
                </div>
                {budget.dailyGoal != null && (
                  <div className={styles.progressTrack} style={{ marginTop: 'var(--space-3)' }}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${Math.min((today / budget.dailyGoal) * 100, 100)}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                )}
                <div className={styles.chartMeta}>
                  <span>
                    {diff === null
                      ? 'defina uma meta diária pra acompanhar'
                      : diff >= 0
                        ? `R$ ${currency(diff)} abaixo da meta hoje`
                        : `R$ ${currency(-diff)} acima da meta hoje`}
                  </span>
                  <MonthDelta current={budget.monthlyAvgDailySpend} previous={budget.previousMonthlyAvgDailySpend} higherIsBetter={false} />
                </div>
                <SmoothLineChart
                  values={budget.last14Days.map((d) => d.amount)}
                  labels={budget.last14Days.map((d) => formatDayLabel(d.date))}
                  threshold={budget.dailyGoal ?? undefined}
                  gradientId="dailySpendGradient"
                  className={styles.evolutionChart}
                />
                <div className={styles.chartMeta}>
                  <span>últimos 14 dias</span>
                  {budget.dailyGoal != null && <span>linha tracejada = meta de R$ {budget.dailyGoal}</span>}
                </div>
              </>
            )}
          </div>

          <div className={styles.card}>
            <CardHeader icon={PieChart} title="Orçamento do mês" href="/orcamento" />

            {budgetError && <div className={styles.emptyState}>Não consegui falar com o backend ainda.</div>}

            {!budgetError && budget && budget.categories.length === 0 && (
              <div className={styles.emptyState}>Nenhum orçamento definido para este mês ainda.</div>
            )}

            {!budgetError && budget && budget.categories.length > 0 && (
              <>
                <div className={styles.progressRow} style={{ marginBottom: 'var(--space-4)' }}>
                  <div className={styles.progressLabel}>
                    <span>Total do mês</span>
                    <span>
                      R$ {budget.totalSpent.toLocaleString('pt-BR')} / R$ {budget.totalPlanned.toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${Math.min((budget.totalSpent / budget.totalPlanned) * 100, 100)}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
                {budget.categories.map((item) => (
                  <div key={item.categoryId} className={styles.progressRow}>
                    <div className={styles.progressLabel}>
                      <span>{item.name}</span>
                      <span>
                        R$ {item.spent.toLocaleString('pt-BR')} / R$ {item.planned.toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{
                          width: `${Math.min((item.spent / item.planned) * 100, 100)}%`,
                          background: 'var(--accent)',
                        }}
                      />
                    </div>
                    <div className={styles.deltaRow}>
                      <MonthDelta current={item.spent} previous={item.previousSpent} higherIsBetter={false} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className={styles.card}>
            <CardHeader icon={Receipt} title="Últimas transações" href="/transacoes" />

            {transactionsError && (
              <div className={styles.emptyState}>Não consegui falar com o backend ainda — confirme se ele está rodando.</div>
            )}

            {!transactionsError && transactions !== null && transactions.length === 0 && (
              <div className={styles.emptyState}>Nenhuma transação esse mês ainda.</div>
            )}

            {!transactionsError &&
              transactions?.map((t) => (
                <div key={t.id} className={styles.listRow}>
                  <div className={styles.listIcon}>💳</div>
                  <div className={styles.listBody}>
                    <div className={styles.listTitle}>{t.description}</div>
                    <div className={styles.listSub}>{t.category?.name ?? 'Sem categoria'}</div>
                  </div>
                  <div className={styles.listValue}>
                    {t.type === 'income' ? (
                      <ArrowLeft size={13} className={styles.dirIn} />
                    ) : (
                      <ArrowRight size={13} className={styles.dirOut} />
                    )}
                    R$ {currency(t.amount)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* ---------- Patrimônio & Investimentos ---------- */}
      <section>
        <h1 className={styles.sectionTitle}>Patrimônio &amp; Investimentos</h1>
        <div className={styles.grid}>
          {wealthError && (
            <div className={`${styles.card} ${styles.fullWidth}`}>
              <div className={styles.emptyState}>Não consegui falar com o backend ainda.</div>
            </div>
          )}

          {!wealthError && wealth && !wealth.hasData && (
            <div className={`${styles.card} ${styles.fullWidth}`}>
              <CardHeader icon={Coins} title="Patrimônio" />
              <div className={styles.emptyState}>
                Nenhum snapshot de investimento ainda — sincronize uma corretora ou lance suas posições pra ver o
                dashboard aqui.
              </div>
            </div>
          )}

          {!wealthError && wealth?.hasData && (
            <>
              <div className={`${styles.card} ${styles.fullWidth}`}>
                <CardHeader icon={Coins} title="Aportes e proventos do mês" />
                <div className={styles.statGrid3}>
                  <div className={styles.statTile}>
                    <span className={styles.heroLabel}>Investido este mês</span>
                    <span className={styles.statTileValue}>R$ {currency(wealth.investedThisMonth ?? 0)}</span>
                    {wealth.investedLastMonth != null && (
                      <MonthDelta current={wealth.investedThisMonth ?? 0} previous={wealth.investedLastMonth} />
                    )}
                  </div>
                  <div className={styles.statTile}>
                    <span className={styles.heroLabel}>Proventos previstos (mês)</span>
                    <span className={styles.statTileValue}>
                      {wealth.projectedDividends != null ? `R$ ${currency(wealth.projectedDividends)}` : '—'}
                    </span>
                    {wealth.projectedDividends != null && wealth.projectedDividendsLastMonth != null && (
                      <MonthDelta current={wealth.projectedDividends} previous={wealth.projectedDividendsLastMonth} />
                    )}
                  </div>
                  <div className={styles.statTile}>
                    <span className={styles.heroLabel}>Patrimônio total</span>
                    <span className={styles.statTileValue}>R$ {currency(wealthTotal)}</span>
                    <MonthDelta current={wealthTotal} previous={wealth.previousTotal ?? wealthTotal} />
                  </div>
                </div>
              </div>

              <div className={`${styles.card} ${styles.fullWidth}`}>
                <CardHeader icon={Flag} title="Primeira Milhão" />
                {!wealthGoal && (
                  <div className={styles.emptyState}>
                    Defina sua meta de patrimônio (aporte mensal, retorno esperado e valor alvo) pra ver a projeção.
                  </div>
                )}
                {wealthGoal && (
                  <>
                    <div className={styles.dailyGoalTop}>
                      <div>
                        <div className={styles.heroLabel}>Progresso até R$ {currency(wealthGoal.targetAmount)}</div>
                        <div className={styles.heroValue}>{goalProgress.toFixed(0)}%</div>
                      </div>
                      <div className={styles.dailyGoalMeta}>
                        <span className={styles.heroLabel}>Faltam</span>
                        <span style={{ fontWeight: 600 }}>R$ {currency(Math.max(0, wealthGoal.targetAmount - wealthTotal))}</span>
                      </div>
                    </div>
                    <div className={styles.progressTrack} style={{ marginTop: 'var(--space-3)' }}>
                      <div className={styles.progressFill} style={{ width: `${goalProgress}%`, background: 'var(--accent)' }} />
                    </div>
                    <div className={styles.chartMeta}>
                      {wealth?.projection === null && (
                        <span>
                          no ritmo atual (R$ {currency(wealthGoal.monthlySavingsTarget)}/mês a {wealthGoal.annualReturnAssumptionPct}% a.a.),
                          a meta não é alcançada nos próximos 50 anos
                        </span>
                      )}
                      {wealth?.projection && wealth.projection.monthsToGoal === 0 && <span>Meta já alcançada 🎉</span>}
                      {wealth?.projection && wealth.projection.monthsToGoal > 0 && (
                        <span>
                          no ritmo atual, você chega lá em{' '}
                          {new Date(wealth.projection.projectedDate).toLocaleDateString('pt-BR', {
                            month: 'long',
                            year: 'numeric',
                          })}{' '}
                          (~{Math.floor(wealth.projection.monthsToGoal / 12)} anos e {wealth.projection.monthsToGoal % 12} meses)
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className={`${styles.card} ${styles.fullWidth}`}>
                <CardHeader icon={LineChart} title="Evolução do patrimônio" href="/patrimonio" />
                <div className={styles.heroValue} style={{ fontSize: '1.6rem' }}>
                  R$ {currency(wealthTotal)}
                </div>
                <div className={styles.chartMeta}>
                  <span>Patrimônio total</span>
                  <MonthDelta current={wealthTotal} previous={wealth.previousTotal ?? wealthTotal} />
                </div>
                {wealth.evolution.length >= 2 ? (
                  <SmoothLineChart
                    values={wealth.evolution.map((e) => e.value)}
                    labels={wealth.evolution.map((e) => e.label)}
                    gradientId="wealthGradient"
                    className={styles.evolutionChart}
                  />
                ) : (
                  <div className={styles.emptyState}>Ainda sem histórico suficiente pra montar a evolução.</div>
                )}
                <div className={styles.chartMeta}>
                  <span>últimos 12 meses com dado</span>
                </div>
              </div>

              <div className={styles.card}>
                <CardHeader icon={PieChart} title="Alocação de investimentos" href="/patrimonio" />
                {wealth.allocation.length > 0 ? (
                  <ClientPieChart data={wealth.allocation} />
                ) : (
                  <div className={styles.emptyState}>Sem posições pra mostrar alocação ainda.</div>
                )}
              </div>

              <div className={styles.card}>
                <CardHeader icon={Activity} title="Destaques do mês" href="/patrimonio" />
                {wealth.movers.length === 0 && <div className={styles.emptyState}>Sem histórico suficiente pra comparar.</div>}
                {wealth.movers.map((m) => (
                  <div key={m.ticker} className={styles.moverRow}>
                    <span className={styles.moverTicker}>{m.ticker}</span>
                    <span className={styles.moverChange}>
                      {m.changePct >= 0 ? (
                        <TrendingUp size={14} className={styles.dirIn} />
                      ) : (
                        <TrendingDown size={14} className={styles.dirOut} />
                      )}
                      {m.changePct >= 0 ? '+' : ''}
                      {m.changePct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---------- Projetos ---------- */}
      <section>
        <h1 className={styles.sectionTitle}>Projetos</h1>
        <div className={styles.grid}>
          {projectsError && (
            <div className={`${styles.card} ${styles.fullWidth}`}>
              <div className={styles.emptyState}>Não consegui falar com o backend ainda.</div>
            </div>
          )}

          {!projectsError && projects && (
            <>
              <div className={`${styles.card} ${styles.fullWidth}`}>
                <CardHeader icon={Briefcase} title="Status financeiro dos projetos" />
                <div className={styles.statGrid3}>
                  <div className={styles.statTile}>
                    <span className={styles.heroLabel}>Recebido este mês</span>
                    <span className={styles.statTileValue}>R$ {currency(projects.receivedThisMonth)}</span>
                    <MonthDelta current={projects.receivedThisMonth} previous={projects.receivedLastMonth} />
                  </div>
                  <div className={styles.statTile}>
                    <span className={styles.heroLabel}>Imposto pago no ano</span>
                    <span className={styles.statTileValue}>R$ {currency(projects.taxPaidThisYear)}</span>
                  </div>
                  <div className={styles.statTile}>
                    <span className={styles.heroLabel}>A receber</span>
                    <span className={styles.statTileValue}>R$ {currency(projects.outstanding)}</span>
                    <MonthDelta current={projects.outstanding} previous={projects.outstandingLastMonth} higherIsBetter={false} />
                  </div>
                </div>
              </div>

              <div className={`${styles.card} ${styles.fullWidth}`}>
                <CardHeader icon={LineChart} title="Recebido no ano" />
                <div className={styles.heroValue} style={{ fontSize: '1.6rem' }}>
                  R$ {currency(projects.receivedThisYear)}
                </div>
                <div className={styles.chartMeta}>
                  <span>Média mensal (últimos 12 meses)</span>
                  <span className={styles.statValue}>R$ {currency(projects.avgMonthly12m)}</span>
                </div>
                <SmoothLineChart
                  values={projects.monthlyReceived.map((m) => m.value)}
                  labels={projects.monthlyReceived.map((m) => m.label)}
                  gradientId="monthlyReceivedGradient"
                  className={styles.evolutionChart}
                />
              </div>

              <div className={styles.card}>
                <CardHeader icon={PieChart} title="Receita por cliente (ano)" href="/projetos" />
                {projects.clientRevenue.length > 0 ? (
                  <ClientPieChart data={projects.clientRevenue} />
                ) : (
                  <div className={styles.emptyState}>Nenhum recebimento este ano ainda.</div>
                )}
              </div>

              <div className={styles.card}>
                <CardHeader icon={Briefcase} title="Projetos ativos" href="/projetos" />
                {projects.activeProjects.length === 0 && <div className={styles.emptyState}>Nenhum projeto em andamento.</div>}
                {projects.activeProjects.map((p) => (
                  <div key={p.id} className={styles.projectRow}>
                    <div className={styles.projectBody}>
                      <div className={styles.projectName}>{p.name}</div>
                      <div className={styles.projectClient}>{p.client}</div>
                    </div>
                    <span className={`${styles.chip} ${styles.success}`}>Em andamento</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
