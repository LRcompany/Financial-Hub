import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowLeft, ArrowRight } from 'lucide-react'
import { api, type Transaction } from '../lib/api'
import styles from './Dashboard.module.css'

// MOCK — sem endpoint de backend ainda. Estrutura já pronta pra virar fetch real
// quando os endpoints existirem (ver docs/blueprint.md — módulos ainda não implementados).
const MOCK_BUDGET = [
  { category: 'Moradia', spent: 3600, planned: 4535, color: 'var(--success)' },
  { category: 'Supermercado', spent: 780, planned: 800, color: 'var(--warning)' },
  { category: 'Compras', spent: 612, planned: 400, color: 'var(--danger)' },
]

const MOCK_WEALTH = { total: 604427.43, monthlyReturnPct: 1.2 }

const MOCK_PROJECTS = [
  { client: 'Cunha Ferraz', project: 'Website', status: 'em_andamento' as const },
  { client: 'MAAC', project: 'MKT Collaterals', status: 'pausado' as const },
  { client: 'Pickleball Forum', project: 'Rental - Ago', status: 'em_andamento' as const },
]

function statusLabel(status: 'em_andamento' | 'pausado') {
  return status === 'em_andamento' ? 'Em andamento' : 'Pausado'
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

  return (
    <div className={styles.grid}>
      {/* Saldo — MOCK, falta endpoint de saldo consolidado */}
      <div className={`${styles.hero} ${styles.fullWidth}`}>
        <div>
          <div className={styles.heroLabel}>Saldo disponível</div>
          <div className={styles.heroValue}>R$ 18.140,32</div>
        </div>
        <div className={styles.heroCta}>
          <ArrowUpRight size={18} strokeWidth={2} />
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
          <h2 className={styles.cardTitle}>Patrimônio</h2>
          <a className={styles.cardLink} href="/patrimonio">
            Ver tudo
          </a>
        </div>
        <div className={styles.heroValue} style={{ fontSize: '1.6rem' }}>
          R$ {MOCK_WEALTH.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </div>
        <div className={styles.chartMeta}>
          <span>Rendimento do mês</span>
          <span style={{ color: 'var(--success)' }}>+{MOCK_WEALTH.monthlyReturnPct}%</span>
        </div>
      </div>

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

      <div className={`${styles.card} ${styles.fullWidth}`}>
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
                R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
