import { useEffect, useRef } from 'react'
import styles from './MonthNavigator.module.css'

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Seletor de mês "‹ out/2026 ›" + botão "Hoje" quando fora do mês atual —
 * ÚNICO no app (nasceu no Orçamento; 02/10 virou componente quando
 * Patrimônio e Projetos ganharam histórico por mês — pedido do Luiz: "pode
 * mostrar o mês anterior em patrimônio e projetos... não podemos perder o
 * histórico das coisas"). `allowFuture={false}` trava o "›" no mês atual
 * (patrimônio/projetos não têm dado de mês que ainda não aconteceu; o
 * Orçamento permite, pra planejar o mês seguinte). */
export function MonthNavigator({
  month,
  year,
  onChange,
  allowFuture = true,
}: {
  month: number
  year: number
  onChange: (month: number, year: number) => void
  allowFuture?: boolean
}) {
  const now = new Date()
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear()
  const atOrAfterNow = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)

  // Espelha month/year sincronamente — dois cliques em sequência rápida não
  // podem computar os dois a partir do mesmo mês antigo (a prop só atualiza
  // no próximo render). Regra que já existia no Orçamento antes de virar
  // componente.
  const lastRef = useRef({ month, year })
  useEffect(() => {
    lastRef.current = { month, year }
  }, [month, year])

  function shift(delta: number) {
    let m = lastRef.current.month + delta
    let y = lastRef.current.year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    if (!allowFuture && (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1))) return
    lastRef.current = { month: m, year: y }
    onChange(m, y)
  }

  return (
    <div className={styles.monthNav}>
      {!isCurrentMonth && (
        <button className={styles.todayBtn} onClick={() => onChange(now.getMonth() + 1, now.getFullYear())}>
          Hoje
        </button>
      )}
      <button className={styles.navBtn} onClick={() => shift(-1)} aria-label="Mês anterior">
        ‹
      </button>
      <span className={styles.monthLabel}>
        {MONTH_NAMES[month - 1]}/{year}
      </span>
      <button className={styles.navBtn} onClick={() => shift(1)} aria-label="Próximo mês" disabled={!allowFuture && atOrAfterNow}>
        ›
      </button>
    </div>
  )
}
