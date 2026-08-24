import { useState } from 'react'
import styles from './ClientPieChart.module.css'

// Paleta categórica própria — evita verde/vermelho de propósito, essas cores
// já têm significado (status) no resto do sistema.
const PALETTE = ['#3E5BFA', '#7C6FF0', '#3FB6A8', '#F2934A', '#C98A1D', '#9B8AFB', '#4FA8D8', '#6B7076']

interface Slice {
  label: string
  value: number
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const [x1, y1] = polarToCartesian(cx, cy, r, endAngle)
  const [x2, y2] = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2} Z`
}

export function ClientPieChart({ data }: { data: Slice[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const cx = 80
  const cy = 80
  const r = 76

  let angle = 0
  const slices = data.map((d, i) => {
    const startAngle = angle
    const sliceAngle = (d.value / total) * 360
    angle += sliceAngle
    return { ...d, startAngle, endAngle: angle, color: PALETTE[i % PALETTE.length] }
  })

  const active = activeIndex !== null ? slices[activeIndex] : null

  return (
    <div className={styles.wrap}>
      <div className={styles.svgBox}>
        <svg viewBox="0 0 160 160" width="160" height="160">
          {slices.map((s, i) => (
            <path
              key={s.label}
              d={arcPath(cx, cy, r, s.startAngle, s.endAngle)}
              fill={s.color}
              className={styles.slice}
              opacity={activeIndex === null || activeIndex === i ? 1 : 0.35}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onTouchStart={() => setActiveIndex(i)}
            />
          ))}
        </svg>
        {active && (
          <div className={styles.tooltip}>
            <div className={styles.tooltipLabel}>{active.label}</div>
            <div className={styles.tooltipValue}>
              R$ {active.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={styles.tooltipLabel}>{((active.value / total) * 100).toFixed(0)}%</div>
          </div>
        )}
      </div>

      <div className={styles.legend}>
        {slices.map((s, i) => (
          <div
            key={s.label}
            className={styles.legendRow}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
            style={{ opacity: activeIndex === null || activeIndex === i ? 1 : 0.4 }}
          >
            <span className={styles.legendDot} style={{ background: s.color }} />
            <span className={styles.legendName}>{s.label}</span>
            <span className={styles.legendValue}>
              R$ {s.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
