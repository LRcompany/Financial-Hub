import { currency } from '../lib/format'
import { Money } from './Money'
import styles from './DailyGoalBalance.module.css'

/** Saldo da meta diária (01/10): soma de `meta - gasto` em todo dia com meta,
 * dia acima da meta desconta. Positivo = "sobrou", negativo = "passou" —
 * sempre o valor absoluto com a palavra certa, nunca um "-R$" solto. Mesmo
 * texto/cor em Dashboard, Orçamento e relatório. */
export function DailyGoalBalance({ value, suffix }: { value: number; suffix?: string }) {
  const over = value < 0
  return (
    <span className={over ? styles.over : styles.under}>
      {over ? 'passou' : 'sobrou'} <Money>R$ {currency(Math.abs(value))}</Money>
      {suffix ? ` ${suffix}` : ''}
    </span>
  )
}
