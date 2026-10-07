import { currency } from '../lib/format'
import { Money } from './Money'
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
      <span className={styles.spent}>
        <Money>R$ {currency(spent)}</Money>
      </span>
      {' / '}
      <PlannedValue value={planned} />
      {suffix ? <span className={styles.plannedSuffix}> {suffix}</span> : ''}
    </>
  )
}

/** Valor ESTIPULADO/planejado sozinho (meta de categoria, total previsto,
 * coluna "Estipulado") — fonte mono + cinza (01/10, pedido do Luiz: "só pra
 * não me confundir quando é o valor gasto real e o que foi estipulado").
 * Único jeito de mostrar um valor planejado no app; gasto real nunca usa. */
export function PlannedValue({ value }: { value: number }) {
  return (
    <span className={styles.planned}>
      <Money>R$ {currency(value)}</Money>
    </span>
  )
}
