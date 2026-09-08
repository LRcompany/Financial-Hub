import { ArrowUp, ArrowDown } from 'lucide-react'
import { currency } from '../lib/format'
import styles from './MonthDelta.module.css'

/** Variação de saldo — NÃO é rentabilidade (pedido do Luiz, 08/09: "em conta
 * corrente não existe cotas, preço, investido... registra isso pela
 * variação"). Mostra o delta em R$ desde o mês anterior, nunca %: um saldo
 * que vai de R$10 pra R$5.000 não é "49900% de rentabilidade", é só um
 * depósito. Mesmo padrão visual do ReturnBadge (seta colorida, texto neutro),
 * mas comparando saldo com saldo, não valor atual com custo de aquisição.
 * Sem mês anterior conhecido (posição nova), não finge uma variação que não
 * existe. */
export function BalanceChangeBadge({ current, previous }: { current: number; previous: number | null }) {
  if (previous == null) return <span>—</span>
  const delta = current - previous
  if (delta === 0) return <span className={styles.delta}>sem mudança</span>
  const isUp = delta > 0
  return (
    <span className={styles.delta}>
      {isUp ? <ArrowUp size={12} className={styles.good} /> : <ArrowDown size={12} className={styles.bad} />}
      {isUp ? '+' : '-'}R$ {currency(Math.abs(delta))}
    </span>
  )
}
