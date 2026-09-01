import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target, PieChart, CreditCard as CreditCardIcon, CalendarClock, Copy, ListChecks, AlertCircle, AlertTriangle, Settings as SettingsIcon } from 'lucide-react'
import { api, type BudgetSummary, type CreditCard, type UpcomingInstallmentsSummary, type BudgetCategory } from '../lib/api'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { MonthDelta } from '../components/MonthDelta'
import { ClientPieChart } from '../components/ClientPieChart'
import { CardHeader } from '../components/CardHeader'
import { BudgetReviewModal } from '../components/BudgetReviewModal'
import { InstallmentReviewModal } from '../components/InstallmentReviewModal'
import { currency } from '../lib/format'
import cards from '../styles/cards.module.css'
import styles from './Orcamento.module.css'

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// Sem seção de "Investimento" — aporte não é gasto, tem home própria em
// Patrimônio (o backend já nem manda categoria desse kind pra cá).
const KIND_SECTIONS: { kind: BudgetCategory['kind']; title: string }[] = [
  { kind: 'essential', title: 'Despesas essenciais' },
  { kind: 'non_essential', title: 'Despesas não essenciais' },
]

/** "2026-08-21" -> "21 ago", sem passar por UTC (senão pode virar o dia anterior). */
function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export function Orcamento() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [error, setError] = useState(false)
  const [cardsList, setCardsList] = useState<CreditCard[]>([])
  const [upcoming, setUpcoming] = useState<UpcomingInstallmentsSummary | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [showInstallmentReview, setShowInstallmentReview] = useState(false)
  const [copying, setCopying] = useState(false)

  function load() {
    api
      .budgetSummary({ month, year })
      .then(setBudget)
      .catch(() => setError(true))
  }

  function loadCardsAndUpcoming() {
    api.creditCards({ month, year }).then((r) => setCardsList(r.cards)).catch(() => {})
    api.upcomingInstallments({ month, year }).then(setUpcoming).catch(() => {})
  }

  useEffect(load, [month, year])
  // Cartões e parcelas futuras acompanham o mês navegado — avançar mês faz o
  // que já venceu sumir da conta (não é fixo, filtrado no backend por mês).
  useEffect(loadCardsAndUpcoming, [month, year])

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

  function goToToday() {
    setMonth(now.getMonth() + 1)
    setYear(now.getFullYear())
  }

  async function copyPreviousMonth() {
    setCopying(true)
    try {
      const result = await api.copyBudgetFromPreviousMonth(month, year)
      load()
      alert(`${result.copied} categoria(s) copiada(s) do mês anterior. ${result.skippedExisting} já tinham meta e não foram sobrescritas.`)
    } finally {
      setCopying(false)
    }
  }

  if (error) {
    return <div className={cards.emptyState}>Não consegui falar com o backend ainda.</div>
  }
  if (!budget) return null

  const today = budget.last14Days[budget.last14Days.length - 1]?.amount ?? 0
  const diff = budget.dailyGoal != null ? budget.dailyGoal - today : null

  // Pizza mostra só onde o dinheiro REALMENTE foi esse mês — categoria sem
  // gasto nenhum não vira fatia (fatia de R$0 não ajuda a ver "onde estou
  // gastando", só polui o gráfico).
  const pieData = budget.categories.filter((c) => c.spent > 0).map((c) => ({ label: c.name, value: c.spent }))

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear()
  const showReviewBanner = isCurrentMonth && now.getDate() <= 5 && budget.categories.length === 0

  return (
    <div className={cards.page}>
      <div className={styles.header}>
        <h1 className={cards.sectionTitle} style={{ margin: 0 }}>
          Orçamento
        </h1>
        <div className={styles.monthNav}>
          {!isCurrentMonth && (
            <button className={styles.todayBtn} onClick={goToToday}>
              Hoje
            </button>
          )}
          <button className={styles.navBtn} onClick={() => changeMonth(-1)} aria-label="Mês anterior">
            ‹
          </button>
          <span className={styles.monthLabel}>
            {MONTH_NAMES[month - 1]}/{year}
          </span>
          <button className={styles.navBtn} onClick={() => changeMonth(1)} aria-label="Próximo mês">
            ›
          </button>
        </div>
      </div>

      {showReviewBanner && (
        <div className={styles.reviewBanner}>
          <AlertCircle size={16} strokeWidth={2} />
          <span>Mês novo — hora de revisar o orçamento de {MONTH_NAMES[month - 1]}/{year}.</span>
          <button className={styles.reviewBannerBtn} onClick={() => setShowReview(true)}>
            Revisar agora
          </button>
        </div>
      )}

      <div className={cards.grid}>
        {/* ---------- total do mês: pizza de onde o dinheiro foi ---------- */}
        <div className={`${cards.card} ${cards.fullWidth}`}>
          <CardHeader
            icon={PieChart}
            title="Onde meu dinheiro foi este mês"
            action={
              <div className={styles.headerActions}>
                <button className={styles.copyBtn} onClick={copyPreviousMonth} disabled={copying}>
                  <Copy size={13} strokeWidth={2} />
                  Copiar mês anterior
                </button>
                <button className={styles.reviewBtn} onClick={() => setShowReview(true)}>
                  <ListChecks size={13} strokeWidth={2} />
                  Revisar orçamento
                </button>
              </div>
            }
          />
          <div className={cards.heroValue} style={{ fontSize: '1.6rem' }}>
            R$ {currency(budget.totalSpent)} <span className={styles.ofPlanned}>/ R$ {currency(budget.totalPlanned)} planejado</span>
          </div>
          <div className={cards.chartMeta}>
            <span>{budget.categories.length} categorias com meta</span>
          </div>
          {pieData.length > 0 ? (
            <div style={{ marginTop: 'var(--space-5)' }}>
              <ClientPieChart data={pieData} />
            </div>
          ) : (
            <div className={cards.emptyState}>Nenhum gasto categorizado ainda esse mês.</div>
          )}
        </div>

        {/* ---------- gasto diário ---------- */}
        <div className={`${cards.card} ${cards.fullWidth}`}>
          <CardHeader
            icon={Target}
            title="Gasto diário"
            action={
              <Link to="/configuracoes" className={styles.copyBtn}>
                <SettingsIcon size={13} strokeWidth={2} />
                Editar meta em Configurações
              </Link>
            }
          />
          <div className={cards.dailyGoalTop}>
            <div>
              <div className={cards.heroLabel}>Gasto de hoje</div>
              <div className={cards.heroValue}>R$ {currency(today)}</div>
            </div>
            <div className={cards.dailyGoalMeta}>
              <span className={cards.heroLabel}>Meta diária</span>
              <span style={{ fontWeight: 600 }}>{budget.dailyGoal != null ? `R$ ${currency(budget.dailyGoal)}` : 'não definida'}</span>
            </div>
          </div>
          {budget.dailyGoal != null && (
            <div className={cards.progressTrack} style={{ marginTop: 'var(--space-3)' }}>
              <div
                className={cards.progressFill}
                style={{ width: `${Math.min((today / budget.dailyGoal) * 100, 100)}%`, background: 'var(--accent)' }}
              />
            </div>
          )}
          <div className={cards.chartMeta}>
            <span>
              {diff === null
                ? 'defina uma meta diária pra acompanhar'
                : diff >= 0
                  ? `R$ ${currency(diff)} abaixo da meta hoje`
                  : `R$ ${currency(-diff)} acima da meta hoje`}
            </span>
            <MonthDelta current={budget.monthlyAvgDailySpend} previous={budget.previousMonthlyAvgDailySpend} higherIsBetter={false} />
          </div>
          <div style={{ marginTop: 'var(--space-5)' }}>
            <h4 className={styles.chartLabel}>Últimos 14 dias</h4>
            <SmoothLineChart
              values={budget.last14Days.map((d) => d.amount)}
              labels={budget.last14Days.map((d) => formatDayLabel(d.date))}
              threshold={budget.dailyGoal ?? undefined}
              gradientId="orcamentoDailyGradient"
              className={cards.evolutionChart}
            />
          </div>
        </div>

        {/* ---------- cartões de crédito ---------- */}
        {cardsList.length > 0 && (
          <div className={`${cards.card} ${cards.fullWidth}`}>
            <CardHeader icon={CreditCardIcon} title="Cartões de crédito" />
            <div className={styles.cardsGrid}>
              {cardsList.map((c) => {
                const hasLimit = c.creditLimit != null && c.creditLimit > 0
                const pct = hasLimit ? (c.usedAmount / c.creditLimit!) * 100 : 0
                return (
                  <div key={c.broker + c.name} className={styles.creditCardTile}>
                    <div className={styles.creditCardHeader}>
                      <span className={styles.creditCardName}>{c.broker}</span>
                      {c.brand && <span className={styles.creditCardBrand}>{c.brand}</span>}
                    </div>
                    <div className={cards.heroValue} style={{ fontSize: '1.2rem' }}>
                      R$ {currency(c.usedAmount)}
                    </div>
                    {hasLimit && (
                      <>
                        <div className={cards.chartMeta}>
                          <span>de R$ {currency(c.creditLimit!)}</span>
                          <span>R$ {currency(c.availableLimit!)} livre</span>
                        </div>
                        <div className={cards.progressTrack} style={{ marginTop: 'var(--space-2)' }}>
                          <div
                            className={cards.progressFill}
                            style={{ width: `${Math.min(pct, 100)}%`, background: pct > 90 ? 'var(--danger)' : 'var(--accent)' }}
                          />
                        </div>
                      </>
                    )}
                    {(c.dueDate || c.minimumPayment != null) && (
                      <div className={styles.creditCardFooter}>
                        {c.dueDate && <span>vencimento {new Date(c.dueDate).toLocaleDateString('pt-BR')}</span>}
                        {c.minimumPayment != null && <span>mínimo R$ {currency(c.minimumPayment)}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ---------- parcelas futuras (compromissos) ---------- */}
        {upcoming && upcoming.installments.length > 0 && (
          <div className={`${cards.card} ${cards.fullWidth}`}>
            <CardHeader
              icon={CalendarClock}
              title="Comprometido em parcelas futuras"
              action={
                <button className={styles.reviewBtn} onClick={() => setShowInstallmentReview(true)}>
                  <ListChecks size={13} strokeWidth={2} />
                  Revisar parcelas
                </button>
              }
            />
            <div className={cards.heroValue} style={{ fontSize: '1.4rem' }}>
              R$ {currency(upcoming.total)}
            </div>
            <div className={cards.chartMeta}>
              <span>{upcoming.installments.length} parcelas a vencer, de compras já feitas</span>
            </div>
            <p className={styles.upcomingDisclaimer}>
              Este total é independente do "usado" mostrado em Cartões de crédito — cada cartão trava limite de um
              jeito diferente pra parcelamento, não necessariamente o valor restante inteiro de uma vez.
            </p>
            <h4 className={styles.chartLabel} style={{ marginTop: 'var(--space-5)' }}>
              Por cartão
            </h4>
            <div className={styles.upcomingByMonth}>
              {upcoming.byCard.map((c) => (
                <div key={c.card} className={styles.upcomingMonthChip}>
                  <span>{c.card}</span>
                  <strong>R$ {currency(c.amount)}</strong>
                </div>
              ))}
            </div>
            <h4 className={styles.chartLabel} style={{ marginTop: 'var(--space-5)' }}>
              Por mês
            </h4>
            <div className={styles.upcomingByMonth}>
              {upcoming.byMonth.map((m) => (
                <div key={m.month} className={styles.upcomingMonthChip}>
                  <span>{formatMonthLabel(m.month)}</span>
                  <strong>R$ {currency(m.amount)}</strong>
                </div>
              ))}
            </div>
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-4)' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Vencimento</th>
                    <th>Descrição</th>
                    <th>Cartão</th>
                    <th>Categoria</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.installments.slice(0, 20).map((i) => (
                    <tr key={i.id}>
                      <td>{new Date(i.dueDate).toLocaleDateString('pt-BR')}</td>
                      <td>
                        {i.note ? (
                          <>
                            {i.note}
                            <div className={styles.installmentRawName}>{i.description}</div>
                          </>
                        ) : (
                          i.description
                        )}
                      </td>
                      <td>{i.cardLabel ?? '—'}</td>
                      <td>{i.category ?? '—'}</td>
                      <td>R$ {currency(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------- categorias, uma coluna por kind, lado a lado ---------- */}
        <div className={`${cards.fullWidth} ${styles.categoryColumns}`}>
          {KIND_SECTIONS.map(({ kind, title }) => {
            const items = budget.categories.filter((c) => c.kind === kind)
            return (
              <div key={kind} className={cards.card}>
                <h3 className={styles.groupTitle}>{title}</h3>
                {items.length === 0 && (
                  <div className={cards.emptyState}>
                    Nenhuma meta de {title.toLowerCase()} pra {MONTH_NAMES[month - 1]}/{year}.
                  </div>
                )}
                {items.map((item) => (
                  <CategoryRow key={item.categoryId} item={item} />
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {showReview && (
        <BudgetReviewModal
          month={month}
          year={year}
          onClose={() => setShowReview(false)}
          onSaved={() => {
            setShowReview(false)
            load()
          }}
        />
      )}

      {showInstallmentReview && (
        <InstallmentReviewModal
          onClose={() => {
            setShowInstallmentReview(false)
            loadCardsAndUpcoming()
          }}
        />
      )}
    </div>
  )
}

/** Meta editável só pelo modal "Revisar orçamento" agora — essa linha é só
 * leitura (nome, gasto/meta, comparação com mês anterior). Sem barra — dentro
 * da meta fica silenciosa, só ganha destaque (ícone + fundo) quando estoura. */
function CategoryRow({ item }: { item: { categoryId: string; name: string; planned: number; spent: number; previousSpent: number } }) {
  const isOver = item.planned > 0 && item.spent > item.planned
  return (
    <div className={`${styles.categoryRow} ${isOver ? styles.categoryRowOver : ''}`}>
      <div className={styles.categoryRowTop}>
        <span className={styles.categoryRowName}>
          {isOver && <AlertTriangle size={13} strokeWidth={2} className={styles.overIcon} />}
          {item.name}
        </span>
        <span className={styles.categoryRowValues}>
          <span className={isOver ? styles.spentOver : styles.spentValue}>R$ {currency(item.spent)}</span>
          {' / '}
          <span className={`${styles.plannedBold} ${isOver ? styles.spentOver : ''}`}>R$ {currency(item.planned)}</span>
        </span>
      </div>
      <div className={cards.deltaRow}>
        <MonthDelta current={item.spent} previous={item.previousSpent} higherIsBetter={false} />
      </div>
    </div>
  )
}
