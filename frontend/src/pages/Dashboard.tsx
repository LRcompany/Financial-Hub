import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Target,
  PieChart,
  Receipt,
  LineChart,
  Coins,
  Activity,
  Briefcase,
} from 'lucide-react'
import { api, type Transaction } from '../lib/api'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { MonthDelta } from '../components/MonthDelta'
import styles from './Dashboard.module.css'

// MOCK — sem endpoint de backend ainda. Estrutura já pronta pra virar fetch real
// quando os endpoints existirem (ver docs/blueprint.md — módulos ainda não implementados).
const DAILY_GOAL = 150

// Últimos 14 dias — mock, futuramente vem de SUM(Transaction) por dia
const MOCK_DAILY_SPEND = [62, 180, 45, 210, 98, 150, 34, 88, 172, 60, 140, 205, 76, 87.4]
const MOCK_MONTHLY_AVG = { current: 118.32, previous: 132.1 }

const MOCK_BUDGET = [
  { category: 'Moradia', spent: 3600, previousSpent: 3550, planned: 4535, color: 'var(--success)' },
  { category: 'Supermercado', spent: 780, previousSpent: 690, planned: 800, color: 'var(--warning)' },
  { category: 'Compras', spent: 612, previousSpent: 950, planned: 400, color: 'var(--danger)' },
]

const MOCK_WEALTH = {
  total: 604427.43,
  previousTotal: 596000,
  investedThisMonth: 7500,
  investedLastMonth: 7500,
  projectedDividends: 2140.6,
  projectedDividendsLastMonth: 1980.2,
}

// Últimos 12 meses — mock, futuramente vem de SUM(PositionSnapshot.marketValue) por mês
const MOCK_WEALTH_EVOLUTION = [
  512000, 498000, 531000, 545000, 560000, 552000, 571000, 583000, 590000, 578000, 596000, 604427,
]

const MOCK_MOVERS = [
  { ticker: 'HGLG11', changePct: 3.2 },
  { ticker: 'PETR4', changePct: -1.8 },
]

const MOCK_PROJECTS = [
  { client: 'Cunha Ferraz', project: 'Website', status: 'em_andamento' as const },
  { client: 'MAAC', project: 'MKT Collaterals', status: 'pausado' as const },
  { client: 'Pickleball Forum', project: 'Rental - Ago', status: 'em_andamento' as const },
]

// Ligado ao próprio dashboard "Visão Geral" da planilha de Projetos (Total Recebido /
// Total a Receber já existiam lá) — mock aqui até o backend do módulo Projetos existir
const MOCK_PROJECT_STATS = {
  receivedThisMonth: 12800,
  receivedLastMonth: 9200,
  receivedThisYear: 182572.48,
  taxPaidThisYear: 6420.35,
  outstanding: 64400,
  outstandingLastMonth: 71000,
}

function statusLabel(status: 'em_andamento' | 'pausado') {
  return status === 'em_andamento' ? 'Em andamento' : 'Pausado'
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
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const now = new Date()
    api
      .transactions({ month: now.getMonth() + 1, year: now.getFullYear() })
      .then((data) => setTransactions(data.slice(0, 5)))
      .catch(() => setLoadError(true))
  }, [])

  const today = MOCK_DAILY_SPEND[MOCK_DAILY_SPEND.length - 1]
  const diff = DAILY_GOAL - today

  return (
    <div className={styles.page}>
      {/* ---------- Dia a dia ---------- */}
      <section>
        <h1 className={styles.sectionTitle}>Dia a dia</h1>
        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.fullWidth}`}>
            <CardHeader icon={Target} title="Meta diária de gasto" />
            <div className={styles.dailyGoalTop}>
              <div>
                <div className={styles.heroLabel}>Gasto de hoje</div>
                <div className={styles.heroValue}>R$ {currency(today)}</div>
              </div>
              <div className={styles.dailyGoalMeta}>
                <span className={styles.heroLabel}>Meta diária</span>
                <span style={{ fontWeight: 600 }}>R$ {DAILY_GOAL.toLocaleString('pt-BR')}</span>
              </div>
            </div>
            <div className={styles.progressTrack} style={{ marginTop: 'var(--space-3)' }}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${Math.min((today / DAILY_GOAL) * 100, 100)}%`,
                  background: today > DAILY_GOAL ? 'var(--danger)' : 'var(--success)',
                }}
              />
            </div>
            <div className={styles.chartMeta}>
              <span>{diff >= 0 ? `R$ ${currency(diff)} abaixo da meta hoje` : `R$ ${currency(-diff)} acima da meta hoje`}</span>
              <MonthDelta current={MOCK_MONTHLY_AVG.current} previous={MOCK_MONTHLY_AVG.previous} higherIsBetter={false} />
            </div>
            <SmoothLineChart
              values={MOCK_DAILY_SPEND}
              threshold={DAILY_GOAL}
              gradientId="dailySpendGradient"
              className={styles.evolutionChart}
            />
            <div className={styles.chartMeta}>
              <span>últimos 14 dias</span>
              <span>linha tracejada = meta de R$ {DAILY_GOAL}</span>
            </div>
          </div>

          <div className={styles.card}>
            <CardHeader icon={PieChart} title="Orçamento do mês" href="/orcamento" />
            {MOCK_BUDGET.map((item) => (
              <div key={item.category} className={styles.progressRow}>
                <div className={styles.progressLabel}>
                  <span>{item.category}</span>
                  <span>
                    R$ {item.spent.toLocaleString('pt-BR')} / R$ {item.planned.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{
                      width: `${Math.min((item.spent / item.planned) * 100, 100)}%`,
                      background: item.color,
                    }}
                  />
                </div>
                <div className={styles.deltaRow}>
                  <MonthDelta current={item.spent} previous={item.previousSpent} higherIsBetter={false} />
                </div>
              </div>
            ))}
          </div>

          <div className={styles.card}>
            <CardHeader icon={Receipt} title="Últimas transações" href="/transacoes" />

            {loadError && (
              <div className={styles.emptyState}>Não consegui falar com o backend ainda — confirme se ele está rodando.</div>
            )}

            {!loadError && transactions !== null && transactions.length === 0 && (
              <div className={styles.emptyState}>Nenhuma transação esse mês ainda.</div>
            )}

            {!loadError &&
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
          <div className={`${styles.card} ${styles.fullWidth}`}>
            <CardHeader icon={LineChart} title="Evolução do patrimônio" href="/patrimonio" />
            <div className={styles.heroValue} style={{ fontSize: '1.6rem' }}>
              R$ {currency(MOCK_WEALTH.total)}
            </div>
            <div className={styles.chartMeta}>
              <span>Patrimônio total</span>
              <MonthDelta current={MOCK_WEALTH.total} previous={MOCK_WEALTH.previousTotal} />
            </div>
            <SmoothLineChart values={MOCK_WEALTH_EVOLUTION} gradientId="wealthGradient" className={styles.evolutionChart} />
            <div className={styles.chartMeta}>
              <span>últimos 12 meses</span>
            </div>
          </div>

          <div className={styles.card}>
            <CardHeader icon={Coins} title="Aportes e proventos do mês" />
            <div className={styles.statRow}>
              <span>Investido este mês</span>
              <span className={styles.statRowRight}>
                <span className={styles.statValue}>R$ {currency(MOCK_WEALTH.investedThisMonth)}</span>
                <MonthDelta current={MOCK_WEALTH.investedThisMonth} previous={MOCK_WEALTH.investedLastMonth} />
              </span>
            </div>
            <div className={styles.statRow}>
              <span>Proventos previstos (mês)</span>
              <span className={styles.statRowRight}>
                <span className={styles.statValue}>R$ {currency(MOCK_WEALTH.projectedDividends)}</span>
                <MonthDelta current={MOCK_WEALTH.projectedDividends} previous={MOCK_WEALTH.projectedDividendsLastMonth} />
              </span>
            </div>
          </div>

          <div className={styles.card}>
            <CardHeader icon={Activity} title="Destaques do mês" href="/patrimonio" />
            {MOCK_MOVERS.map((m) => (
              <div key={m.ticker} className={styles.moverRow}>
                <span className={styles.moverTicker}>{m.ticker}</span>
                <span className={styles.moverChange}>
                  {m.changePct >= 0 ? (
                    <TrendingUp size={14} className={styles.dirIn} />
                  ) : (
                    <TrendingDown size={14} className={styles.dirOut} />
                  )}
                  {m.changePct >= 0 ? '+' : ''}
                  {m.changePct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Projetos ---------- */}
      <section>
        <h1 className={styles.sectionTitle}>Projetos</h1>
        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.fullWidth}`}>
            <CardHeader icon={Briefcase} title="Resumo financeiro dos projetos" />
            <div className={styles.statGrid}>
              <div className={styles.statTile}>
                <span className={styles.heroLabel}>Recebido este mês</span>
                <span className={styles.statTileValue}>R$ {currency(MOCK_PROJECT_STATS.receivedThisMonth)}</span>
                <MonthDelta current={MOCK_PROJECT_STATS.receivedThisMonth} previous={MOCK_PROJECT_STATS.receivedLastMonth} />
              </div>
              <div className={styles.statTile}>
                <span className={styles.heroLabel}>Recebido no ano</span>
                <span className={styles.statTileValue}>R$ {currency(MOCK_PROJECT_STATS.receivedThisYear)}</span>
              </div>
              <div className={styles.statTile}>
                <span className={styles.heroLabel}>Imposto pago no ano</span>
                <span className={styles.statTileValue}>R$ {currency(MOCK_PROJECT_STATS.taxPaidThisYear)}</span>
              </div>
              <div className={styles.statTile}>
                <span className={styles.heroLabel}>A receber</span>
                <span className={styles.statTileValue}>R$ {currency(MOCK_PROJECT_STATS.outstanding)}</span>
                <MonthDelta
                  current={MOCK_PROJECT_STATS.outstanding}
                  previous={MOCK_PROJECT_STATS.outstandingLastMonth}
                  higherIsBetter={false}
                />
              </div>
            </div>
          </div>

          <div className={`${styles.card} ${styles.fullWidth}`}>
            <CardHeader icon={Briefcase} title="Projetos ativos" href="/projetos" />
            {MOCK_PROJECTS.map((p) => (
              <div key={p.project} className={styles.projectRow}>
                <div className={styles.projectBody}>
                  <div className={styles.projectName}>{p.project}</div>
                  <div className={styles.projectClient}>{p.client}</div>
                </div>
                <span className={`${styles.chip} ${p.status === 'em_andamento' ? styles.success : styles.warning}`}>
                  {statusLabel(p.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
