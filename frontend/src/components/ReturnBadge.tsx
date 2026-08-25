import { ArrowUp, ArrowDown } from 'lucide-react'
import styles from './MonthDelta.module.css'

/** Rentabilidade (atual vs. investido) — mesmo padrão visual do MonthDelta:
 * seta colorida indica a direção, texto sempre neutro (regra do Design
 * System, nunca texto verde/vermelho pra valor). Sem investido conhecido
 * (0 ou igual ao atual por não termos custo real ainda), não mostra nada
 * fingindo uma rentabilidade que não sabemos. */
export function ReturnBadge({ invested, current }: { invested: number; current: number }) {
  if (!invested) return <span>—</span>
  const pct = ((current - invested) / invested) * 100
  const isUp = pct >= 0
  return (
    <span className={styles.delta}>
      {isUp ? <ArrowUp size={12} className={styles.good} /> : <ArrowDown size={12} className={styles.bad} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}
