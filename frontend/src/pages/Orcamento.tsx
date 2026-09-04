import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target, PieChart, CreditCard as CreditCardIcon, CalendarClock, Copy, ListChecks, AlertCircle, AlertTriangle, Settings as SettingsIcon, RefreshCw, Plus, Minus, TrendingUp } from 'lucide-react'
import { api, type BudgetSummary, type CreditCard, type UpcomingInstallmentsSummary, type BudgetCategory } from '../lib/api'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { MonthDelta } from '../components/MonthDelta'
import { ClientPieChart } from '../components/ClientPieChart'
import { CardHeader } from '../components/CardHeader'
import { Carousel } from '../components/Carousel'
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

/** "9, 2026" -> "set/26" — label curto pro chip do carrossel "Por mês". */
function formatMonthLabel(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1]}/${String(year).slice(2)}`
}

export function Orcamento() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  // Espelha month/year sincronamente — changeMonth lê daqui em vez do state
  // (que só atualiza no próximo render), pra dois cliques em sequência
  // rápida não computarem os dois a partir do mesmo mês antigo.
  const periodRef = useRef({ month, year })
  useEffect(() => {
    periodRef.current = { month, year }
  }, [month, year])

  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [error, setError] = useState(false)
  const [cardsList, setCardsList] = useState<CreditCard[]>([])
  const [upcoming, setUpcoming] = useState<UpcomingInstallmentsSummary | null>(null)
  // Mês escolhido no carrossel "Por mês" do box de parcelas — independente
  // do mês navegado na página (04/09: "se eu clicar em outubro vou ver o
  // que foi parcelado em outubro, se eu clicar em novembro..."). null =
  // segue o mês da página (comportamento padrão).
  const [installmentMonth, setInstallmentMonth] = useState<{ month: number; year: number } | null>(null)
  const [installmentDetail, setInstallmentDetail] = useState<UpcomingInstallmentsSummary | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [showInstallmentReview, setShowInstallmentReview] = useState(false)
  const [copying, setCopying] = useState(false)
  const [syncingTx, setSyncingTx] = useState(false)

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
  // Também reseta a seleção do carrossel de parcelas pro mês da página.
  useEffect(() => {
    loadCardsAndUpcoming()
    setInstallmentMonth(null)
    setInstallmentDetail(null)
  }, [month, year])

  // Clicar num mês do carrossel "Por mês" busca só aquele mês, sem navegar
  // o resto da página (Cartões, categorias, gráfico diário continuam no mês
  // atual da página).
  function selectInstallmentMonth(m: number, y: number) {
    if (m === month && y === year) {
      setInstallmentMonth(null)
      setInstallmentDetail(null)
      return
    }
    setInstallmentMonth({ month: m, year: y })
    api.upcomingInstallments({ month: m, year: y }).then(setInstallmentDetail).catch(() => {})
  }

  const displayedInstallments = installmentDetail ?? upcoming
  const selectedInstallmentPeriod = installmentMonth ?? { month, year }

  function changeMonth(delta: number) {
    let m = periodRef.current.month + delta
    let y = periodRef.current.year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    periodRef.current = { month: m, year: y }
    setMonth(m)
    setYear(y)
  }

  function goToToday() {
    periodRef.current = { month: now.getMonth() + 1, year: now.getFullYear() }
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

  async function syncTransactions() {
    setSyncingTx(true)
    try {
      const r = await api.syncCreditCardTransactions()
      loadCardsAndUpcoming()
      alert(
        `${r.transactionsSynced} transação(ões) nova(s) puxada(s) da Pluggy (${r.transactionsSkipped} já existiam).\n` +
          `${r.transactionsReconciled} pendente(s) confirmada(s) agora (descrição/valor atualizados pro dado real).\n` +
          `${r.installmentsCreated} parcela(s) futura(s) identificada(s) automaticamente.\n` +
          `${r.categorizedCount} categorizada(s) sozinha(s) — o resto revisa em "Revisar parcelas".`
      )
    } catch (err) {
      alert(`Falha ao sincronizar: ${(err as Error).message}`)
    } finally {
      setSyncingTx(false)
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
        {/* ---------- entradas do mês (Salário + Projetos, etc.) ---------- */}
        <div className={`${cards.card} ${cards.fullWidth}`}>
          <CardHeader icon={TrendingUp} title="Entradas do mês" />
          <div className={cards.heroValue} style={{ fontSize: '1.6rem' }}>
            R$ {currency(budget.totalIncome)}
          </div>
          <div className={cards.chartMeta}>
            <span>
              {budget.incomeFromProjects > 0
                ? `dos quais R$ ${currency(budget.incomeFromProjects)} vieram de Projetos`
                : 'nenhum recebimento de Projetos esse mês'}
            </span>
            <MonthDelta current={budget.totalIncome} previous={budget.previousTotalIncome} />
          </div>
        </div>

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
            <CardHeader
              icon={CreditCardIcon}
              title="Cartões de crédito"
              action={
                <button className={styles.copyBtn} onClick={syncTransactions} disabled={syncingTx}>
                  <RefreshCw size={13} strokeWidth={2} className={syncingTx ? styles.spinningIcon : ''} />
                  {syncingTx ? 'Sincronizando...' : 'Atualizar transações'}
                </button>
              }
            />
            <div className={styles.cardsGrid}>
              {cardsList.map((c) => {
                const hasLimit = c.creditLimit != null && c.creditLimit > 0
                const pct = hasLimit ? (c.usedAmount / c.creditLimit!) * 100 : 0
                return (
                  <div key={c.broker + c.name} className={styles.creditCardTile}>
                    <div className={styles.creditCardHeader}>
                      <span className={styles.creditCardName}>{c.broker}</span>
                      <div className={styles.creditCardBadges}>
                        {c.brand && <span className={styles.creditCardBrand}>{c.brand}</span>}
                        {c.estimated && <span className={styles.estimatedTag}>estimado</span>}
                      </div>
                    </div>
                    <div className={cards.heroValue} style={{ fontSize: '1.2rem' }}>
                      R$ {currency(c.usedAmount)}
                    </div>
                    {c.estimated && (
                      <p className={styles.estimatedNote}>
                        Projeção a partir do usado de hoje e das parcelas dessa fatura que vencem até este mês — o
                        banco não informa o "usado" de um mês diferente do atual, pode não bater exato quando o mês
                        chegar.
                      </p>
                    )}
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
        {upcoming && (upcoming.installments.length > 0 || upcoming.byMonth.length > 0) && displayedInstallments && (
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
              R$ {currency(displayedInstallments.total)}
            </div>
            <div className={cards.chartMeta}>
              <span>
                {displayedInstallments.installments.length} parcela(s) a vencer em{' '}
                {formatMonthLabel(selectedInstallmentPeriod.month, selectedInstallmentPeriod.year)}, de compras já
                feitas
              </span>
            </div>
            <p className={styles.upcomingDisclaimer}>
              Este total é independente do "usado" mostrado em Cartões de crédito — cada cartão trava limite de um
              jeito diferente pra parcelamento, não necessariamente o valor restante inteiro de uma vez.
            </p>
            {upcoming.byMonth.length > 1 && (
              <>
                <h4 className={styles.chartLabel} style={{ marginTop: 'var(--space-5)' }}>
                  Por mês
                </h4>
                <Carousel
                  items={upcoming.byMonth}
                  perPage={6}
                  keyExtractor={(m) => `${m.year}-${m.month}`}
                  className={styles.upcomingByMonth}
                  renderItem={(m) => {
                    const active = m.month === selectedInstallmentPeriod.month && m.year === selectedInstallmentPeriod.year
                    return (
                      <button
                        type="button"
                        className={`${styles.upcomingMonthChip} ${active ? styles.upcomingMonthChipActive : ''}`}
                        onClick={() => selectInstallmentMonth(m.month, m.year)}
                      >
                        <span>{formatMonthLabel(m.month, m.year)}</span>
                        <strong>R$ {currency(m.amount)}</strong>
                      </button>
                    )
                  }}
                />
              </>
            )}
            <h4 className={styles.chartLabel} style={{ marginTop: 'var(--space-5)' }}>
              Por cartão
            </h4>
            <div className={styles.upcomingByMonth}>
              {displayedInstallments.byCard.map((c) => (
                <div key={c.card} className={styles.upcomingMonthChip}>
                  <span>{c.card}</span>
                  <strong>R$ {currency(c.amount)}</strong>
                </div>
              ))}
            </div>
            <div className={styles.tableWrap} style={{ marginTop: 'var(--space-4)' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Vencimento</th>
                    <th>Descrição</th>
                    <th>Parcela</th>
                    <th>Cartão</th>
                    <th>Categoria</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedInstallments.installments.map((i) => (
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
                      <td>{i.installmentNumber && i.totalInstallments ? `${i.installmentNumber}/${i.totalInstallments}` : '—'}</td>
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

        {/* ---------- categorias, uma coluna por kind, agrupadas por pai ---------- */}
        <div className={`${cards.fullWidth} ${styles.categoryColumns}`}>
          {KIND_SECTIONS.map(({ kind, title }) => {
            const items = budget.categories.filter((c) => c.kind === kind)
            const totalPlanned = items.reduce((s, c) => s + c.planned, 0)
            const totalSpent = items.reduce((s, c) => s + c.spent, 0)

            const groups = new Map<string, BudgetCategory[]>()
            for (const item of items) {
              const key = item.parentName ?? 'Outras'
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key)!.push(item)
            }
            const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))

            return (
              <div key={kind} className={cards.card}>
                <h3 className={styles.groupTitle}>{title}</h3>
                {items.length > 0 && (
                  <div className={styles.kindSummary}>
                    <div>
                      <span className={styles.kindSummaryLabel}>Previsto</span>
                      <span className={styles.kindSummaryValue}>R$ {currency(totalPlanned)}</span>
                    </div>
                    <div>
                      <span className={styles.kindSummaryLabel}>Gasto</span>
                      <span className={styles.kindSummaryValue}>R$ {currency(totalSpent)}</span>
                    </div>
                  </div>
                )}
                {items.length === 0 && (
                  <div className={cards.emptyState}>
                    Nenhuma meta de {title.toLowerCase()} pra {MONTH_NAMES[month - 1]}/{year}.
                  </div>
                )}
                {sortedGroups.map(([parentName, groupItems]) => (
                  <ParentAccordion key={parentName} parentName={parentName} items={groupItems} />
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

/** Uma categoria-mãe (Moradia, Transporte...) em accordion — fechada mostra só
 * o total agregado das filhas, aberta lista cada uma. Fechado por padrão:
 * ~80 folhas juntas listadas de uma vez era ilegível, aqui só abre quem
 * interessa no momento. */
function ParentAccordion({ parentName, items }: { parentName: string; items: BudgetCategory[] }) {
  const [open, setOpen] = useState(false)
  const planned = items.reduce((s, c) => s + c.planned, 0)
  const spent = items.reduce((s, c) => s + c.spent, 0)
  const isOver = planned > 0 && spent > planned

  return (
    <div className={`${styles.accordion} ${open ? styles.accordionOpen : ''}`}>
      <button className={styles.accordionHeader} onClick={() => setOpen((v) => !v)}>
        <span className={styles.accordionToggle}>{open ? <Minus size={13} strokeWidth={2.5} /> : <Plus size={13} strokeWidth={2.5} />}</span>
        <span className={styles.accordionName}>
          {isOver && <AlertTriangle size={13} strokeWidth={2} className={styles.overIcon} />}
          {parentName}
        </span>
        <span className={styles.categoryRowValues}>
          <span className={isOver ? styles.spentOver : styles.spentValue}>R$ {currency(spent)}</span>
          {' / '}
          <span className={`${styles.plannedBold} ${isOver ? styles.spentOver : ''}`}>R$ {currency(planned)}</span>
        </span>
      </button>
      {open && (
        <div className={styles.accordionBody}>
          {items.map((item) => (
            <CategoryRow key={item.categoryId} item={item} />
          ))}
        </div>
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
