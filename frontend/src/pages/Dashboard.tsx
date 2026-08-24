import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { api, type Transaction } from '../lib/api'
import styles from './Dashboard.module.css'

// MOCK — sem endpoint de backend ainda. Estrutura já pronta pra virar fetch real
// quando os endpoints existirem (ver docs/blueprint.md — módulos ainda não implementados).
const DAILY_GOAL = 150

// Últimos 14 dias — mock, futuramente vem de SUM(Transaction) por dia
const MOCK_DAILY_SPEND = [
  62, 180, 45, 210, 98, 150, 34, 88, 172, 60, 140, 205, 76, 87.4,
]

const MOCK_BUDGET = [
  { category: 'Moradia', spent: 3600, planned: 4535, color: 'var(--success)' },
  { category: 'Supermercado', spent: 780, planned: 800, color: 'var(--warning)' },
  { category: 'Compras', spent: 612, planned: 400, color: 'var(--danger)' },
]

const MOCK_WEALTH = { total: 604427.43, monthlyReturnPct: 1.2 }

const MOCK_MOVERS = [
  { ticker: 'HGLG11', changePct: 3.2 },
  { ticker: 'PETR4', changePct: -1.8 },
]

const MOCK_PROJECTS = [
  { client: 'Cunha Ferraz', project: 'Website', status: 'em_andamento' as const },
  { client: 'MAAC', project: 'MKT Collaterals', status: 'pausado' as const },
  { client: 'Pickleball Forum', project: 'Rental - Ago', status: 'em_andamento' as const },
]

function statusLabel(status: 'em_andamento' | 'pausado') {
  return status === 'em_andamento' ? 'Em andamento' : 'Pausado'
}

function currency(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
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
  const maxSpend = Math.max(...MOCK_DAILY_SPEND, DAILY_GOAL)

  return (
    <div className={styles.page}>
      {/* ---------- Dia a dia ---------- */}
      <section>
        <h1 className={styles.sectionTitle}>Dia a dia</h1>
        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.fullWidth}`}>
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
              <span style={{ color: diff >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {diff >= 0 ? `R$ ${currency(diff)} abaixo da meta` : `R$ ${currency(-diff)} acima da meta`}
              </span>
              <span>últimos 14 dias</span>
            </div>
            <div className={styles.barChart}>
              {MOCK_DAILY_SPEND.map((value, i) => (
                <div
                  key={i}
                  className={styles.bar}
                  style={{
                    height: `${(value / maxSpend) * 100}%`,
                    background: value > DAILY_GOAL ? 'var(--danger)' : 'var(--success)',
                  }}
                />
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Orçamento do mês</h2>
              <a className={styles.cardLink} href="/orcamento">
                Ver tudo
              </a>
            </div>
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
              </div>
            ))}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Últimas transações</h2>
              <a className={styles.cardLink} href="/transacoes">
                Ver tudo
              </a>
            </div>

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
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Patrimônio total</h2>
              <a className={styles.cardLink} href="/patrimonio">
                Ver tudo
              </a>
            </div>
            <div className={styles.heroValue} style={{ fontSize: '1.6rem' }}>
              R$ {currency(MOCK_WEALTH.total)}
            </div>
            <div className={styles.chartMeta}>
              <span>Rendimento do mês</span>
              <span style={{ color: 'var(--success)' }}>+{MOCK_WEALTH.monthlyReturnPct}%</span>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Destaques do mês</h2>
              <a className={styles.cardLink} href="/patrimonio">
                Ver tudo
              </a>
            </div>
            {MOCK_MOVERS.map((m) => (
              <div key={m.ticker} className={styles.moverRow}>
                <span className={styles.moverTicker}>{m.ticker}</span>
                <span className={m.changePct >= 0 ? styles.dirIn : styles.dirOut} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  {m.changePct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
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
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Projetos ativos</h2>
              <a className={styles.cardLink} href="/projetos">
                Ver tudo
              </a>
            </div>
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
