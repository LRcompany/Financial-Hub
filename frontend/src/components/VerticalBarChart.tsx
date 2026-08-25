import { currency } from '../lib/format'
import styles from './VerticalBarChart.module.css'

interface Item {
  label: string
  value: number
}

/** Barras verticais, 100% da largura — a maior fica destacada (gradiente +
 * rótulo em pill preto), o resto em tom neutro. Escala melhor que pizza
 * quando tem muito ativo (Ação/FII), e cabe mais opção que a versão
 * horizontal por ser full-width. */
export function VerticalBarChart({ data, max = 10 }: { data: Item[]; max?: number }) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, d) => sum + d.value, 0)
  const visible = sorted.slice(0, max)
  const restTotal = sorted.slice(max).reduce((sum, d) => sum + d.value, 0)
  const bars = restTotal > 0 ? [...visible, { label: 'Outros', value: restTotal }] : visible
  const maxValue = Math.max(...bars.map((b) => b.value), 1)

  return (
    <div className={styles.chart}>
      {bars.map((b, i) => (
        <div key={b.label} className={styles.col}>
          <span className={styles.pct}>{((b.value / total) * 100).toFixed(1)}%</span>
          <div
            className={`${styles.bar} ${i === 0 ? styles.barHighlight : ''}`}
            style={{ height: `${Math.max((b.value / maxValue) * 100, 6)}%` }}
            title={`R$ ${currency(b.value)}`}
          />
          <span className={i === 0 ? styles.labelHighlight : styles.label}>{b.label}</span>
        </div>
      ))}
    </div>
  )
}
