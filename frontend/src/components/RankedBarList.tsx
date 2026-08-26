import { currency } from '../lib/format'
import { HoverCard, HoverRow } from './HoverCard'
import styles from './RankedBarList.module.css'

interface Item {
  label: string
  value: number
  /** Quando esse item agrupa mais de uma posição (ex: "CDB" juntando corretoras
   * diferentes), mostra o detalhe no hover — nunca some com o dado, só some com
   * a barra se não tiver nada de fato agrupado (breakdown.length < 2). */
  breakdown?: { label: string; value: number }[]
}

/** Lista de barras ranqueadas — alternativa ao pizza quando tem muito item
 * (uma pizza de 20+ fatias fica ilegível; barra ordenada escala melhor). */
export function RankedBarList({ data, max = 8 }: { data: Item[]; max?: number }) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, d) => sum + d.value, 0)
  const visible = sorted.slice(0, max)
  const restTotal = sorted.slice(max).reduce((sum, d) => sum + d.value, 0)
  const rows =
    restTotal > 0
      ? [...visible, { label: 'Outros', value: restTotal, breakdown: sorted.slice(max) }]
      : visible
  const topValue = rows[0]?.value ?? 1

  return (
    <div className={styles.list}>
      {rows.map((item) => (
        <div key={item.label} className={styles.row}>
          <div className={styles.rowTop}>
            <HoverCard
              content={
                item.breakdown && item.breakdown.length > 1
                  ? item.breakdown.map((b) => <HoverRow key={b.label} label={b.label} value={`R$ ${currency(b.value)}`} />)
                  : null
              }
            >
              <span className={styles.label}>{item.label}</span>
            </HoverCard>
            <span className={styles.value}>
              R$ {currency(item.value)} <span className={styles.pct}>({((item.value / total) * 100).toFixed(0)}%)</span>
            </span>
          </div>
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: `${(item.value / topValue) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
