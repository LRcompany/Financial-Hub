import { ArrowUp, ArrowDown } from 'lucide-react'
import styles from './MonthDelta.module.css'

interface MonthDeltaProps {
  current: number
  previous: number
  /** true = quanto maior, melhor (ex: recebido). false = quanto maior, pior (ex: imposto pago). */
  higherIsBetter?: boolean
}

/**
 * Seta colorida (nunca texto colorido — regra do Design System) comparando
 * com o mês anterior. A cor da seta segue a direção real da mudança;
 * `higherIsBetter` existe só pra decidir se sobe = seta verde ou vermelha.
 */
export function MonthDelta({ current, previous, higherIsBetter = true }: MonthDeltaProps) {
  if (previous === 0) return null
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const isUp = pct >= 0
  const isGood = higherIsBetter ? isUp : !isUp

  return (
    <span className={styles.delta}>
      {isUp ? (
        <ArrowUp size={12} className={isGood ? styles.good : styles.bad} />
      ) : (
        <ArrowDown size={12} className={isGood ? styles.good : styles.bad} />
      )}
      {Math.abs(pct).toFixed(1)}% vs. mês anterior
    </span>
  )
}
