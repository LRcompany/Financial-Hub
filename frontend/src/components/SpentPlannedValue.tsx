import { currency } from '../lib/format'
import styles from './SpentPlannedValue.module.css'

/** Par "R$ gasto / R$ planejado" — ÚNICO lugar que define essa hierarquia
 * (pedido do Luiz, 11/09: "deixa o que gastei em preto bold e o planejado
 * regular/fino em cinza médio... essa config do estilo nos valores precisa
 * se aplicar em todo o site"). Estourar a meta NUNCA muda a cor daqui —
 * quem sinaliza isso é só o ícone de alerta ao lado (ver `AlertTriangle`
 * nos componentes que usam isso) e a seta do `MonthDelta`. */
export function SpentPlannedValue({ spent, planned, suffix }: { spent: number; planned: number; suffix?: string }) {
  return (
    <>
      <span className={styles.spent}>R$ {currency(spent)}</span>
      {' / '}
      <span className={styles.planned}>
        R$ {currency(planned)}
        {suffix ? ` ${suffix}` : ''}
      </span>
    </>
  )
}
