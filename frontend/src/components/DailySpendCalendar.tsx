import { currency } from '../lib/format'
import { HoverCard, HoverRow } from './HoverCard'
import { Money } from './Money'
import styles from './DailySpendCalendar.module.css'

interface DaySpend {
  /** "AAAA-MM-DD", sempre dia do mês-calendário ATUAL (mesmo período de
   * `daysThisMonth` em `budget.ts` — nunca o mês navegado em Orçamento). */
  date: string
  amount: number
  /** null = nenhuma meta diária estava em vigor nesse dia — dia fica neutro
   * no calendário, nunca "abaixo"/"acima" de uma meta que não existia. */
  goal: number | null
  breakdown: { label: string; value: number; projected?: boolean }[]
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

/** Segunda forma de ver "gasto diário" (pedido do Luiz, 15/09: "quero ver
 * quais dias fiquei abaixo da meta e quais fiquei fora, visualmente... pode
 * ser no mesmo box, duas formas de visualizar"). Mesmo dado do
 * `SmoothLineChart` ao lado (`daysThisMonth`) — só muda a forma de olhar:
 * aqui a pergunta é "que DIAS estouraram", não "qual foi o valor exato".
 * Grade de calendário completa do mês-calendário atual (com célula vazia
 * antes do dia 1 pra alinhar o dia da semana, e depois do último dia real
 * até o fim do mês — dia futuro não tem dado, fica sem cor de propósito,
 * nunca inventa "abaixo da meta" pra um dia que ainda nem aconteceu). */
export function DailySpendCalendar({ days }: { days: DaySpend[] }) {
  if (days.length === 0) return null

  const [firstYear, firstMonth] = days[0].date.split('-').map(Number)
  const daysInMonth = new Date(firstYear, firstMonth, 0).getDate()
  const firstWeekday = new Date(firstYear, firstMonth - 1, 1).getDay()
  const byDate = new Map(days.map((d) => [d.date, d]))

  const cells: ({ dayNumber: number; data: DaySpend | null } | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const dateStr = `${firstYear}-${String(firstMonth).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`
    cells.push({ dayNumber, data: byDate.get(dateStr) ?? null })
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.weekdays}>
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className={styles.weekday}>
            {w}
          </span>
        ))}
      </div>
      <div className={styles.grid}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className={styles.cell} />
          const { dayNumber, data } = cell
          // Mesma regra já corrigida em 14/09 (Orçamento/Dashboard/Patrimônio):
          // "estourou" é sempre `spent > planned`, nunca `planned > 0 &&
          // spent > planned` — meta zerada com gasto real também é estouro.
          const status: 'over' | 'under' | 'neutral' | 'future' =
            data == null ? 'future' : data.goal == null ? 'neutral' : data.amount > data.goal ? 'over' : 'under'
          // Ordem "recibo" (15/09, pedido do Luiz vendo o popup: "a hierarquia
          // está confusa... não precisa repetir a meta aqui, e mude gasto
          // pra total, coloca abaixo de tudo") — meta já aparece no card (não
          // precisa duplicar aqui); itens primeiro, "Total" por último,
          // como a soma de uma nota, não como cabeçalho.
          const content =
            data == null || (data.amount === 0 && data.breakdown.length === 0)
              ? null
              : [
                  ...data.breakdown.map((b, bi) => (
                    <HoverRow key={`b-${bi}`} label={b.label} value={<Money>{`R$ ${currency(b.value)}`}</Money>} />
                  )),
                  <HoverRow key="total" label="Total" value={<Money>{`R$ ${currency(data.amount)}`}</Money>} />,
                ]
          return (
            <HoverCard key={i} content={content} className={styles.dayTrigger}>
              <div className={`${styles.cell} ${styles[`cell-${status}`]}`}>
                <span className={styles.dayNumber}>{dayNumber}</span>
              </div>
            </HoverCard>
          )
        })}
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotUnder}`} /> abaixo da meta
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotOver}`} /> acima da meta
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotNeutral}`} /> sem meta definida
        </span>
      </div>
    </div>
  )
}
