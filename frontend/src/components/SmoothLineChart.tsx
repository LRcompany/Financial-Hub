import { useRef, useState } from 'react'
import styles from './SmoothLineChart.module.css'

const GRADIENT_STOPS = [
  { offset: '0%', color: '#F0605A' },
  { offset: '22%', color: '#F2934A' },
  { offset: '42%', color: '#F0C24B' },
  { offset: '62%', color: '#7FC96B' },
  { offset: '80%', color: '#3FB6A8' },
  { offset: '100%', color: '#3E5BFA' },
]

/** Índices dos pontos que ganham uma linha vertical de referência sempre
 * visível (não só no hover) — demarcação mínima pra dar uma noção de escala
 * de primeira, sem precisar passar o mouse. Com poucos pontos, marca todos;
 * com muitos (ex: 24 meses), limita a um número razoável pra não virar um
 * "código de barras" — sempre inclui o primeiro e o último. */
function pickTickIndices(count: number, max = 8): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i)
  const step = (count - 1) / (max - 1)
  const indices = new Set<number>()
  for (let i = 0; i < max; i++) indices.add(Math.round(i * step))
  return [...indices].sort((a, b) => a - b)
}

/** Catmull-Rom → cúbica de Bézier — curva suave passando por todos os pontos. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`
  }
  return d
}

interface SmoothLineChartProps {
  values: number[]
  /** Rótulo de cada ponto pro tooltip (ex: "21 ago"). Sem isso, usa "Ponto N". */
  labels?: string[]
  /** Linha de referência tracejada (ex: meta diária) — omitir quando não fizer sentido (ex: patrimônio). */
  threshold?: number
  height?: number
  gradientId: string
  className?: string
  valuePrefix?: string
}

export function SmoothLineChart({
  values,
  labels,
  threshold,
  height = 90,
  gradientId,
  className,
  valuePrefix = 'R$ ',
}: SmoothLineChartProps) {
  const width = 600
  const padY = 10
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const allValues = threshold ? [...values, threshold] : values
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const range = max - min || 1

  const points: [number, number][] = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - padY - ((v - min) / range) * (height - padY * 2),
  ])

  const linePath = smoothPath(points)
  const areaPath = `${linePath} L${points[points.length - 1][0]},${height} L0,${height} Z`
  const thresholdY = threshold !== undefined ? height - padY - ((threshold - min) / range) * (height - padY * 2) : null
  const tickIndices = pickTickIndices(points.length)

  function updateHoverFromClientX(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = (clientX - rect.left) / rect.width
    const index = Math.round(ratio * (values.length - 1))
    setHoverIndex(Math.max(0, Math.min(values.length - 1, index)))
  }

  const hover = hoverIndex !== null ? points[hoverIndex] : null

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${className ?? ''}`}
      onMouseMove={(e) => updateHoverFromClientX(e.clientX)}
      onMouseLeave={() => setHoverIndex(null)}
      onTouchMove={(e) => updateHoverFromClientX(e.touches[0].clientX)}
      onTouchEnd={() => setHoverIndex(null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={styles.svg} style={{ height }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            {GRADIENT_STOPS.map((s) => (
              <stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
          <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Demarcação sempre visível (não só no hover) — dá uma referência de
            escala de primeira, sem precisar passar o mouse. Bem sutil de
            propósito (opacidade baixa) pra não competir com a linha de dado;
            o hover continua sendo o jeito de ver o valor exato de cada uma. */}
        {tickIndices.map((i) => (
          <line key={i} x1={points[i][0]} y1={0} x2={points[i][0]} y2={height} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
        ))}

        {thresholdY !== null && (
          <line x1={0} y1={thresholdY} x2={width} y2={thresholdY} stroke="var(--ink-faint)" strokeWidth={1} strokeDasharray="4 4" />
        )}

        <path d={areaPath} fill={`url(#${gradientId}-fill)`} stroke="none" />
        <path d={linePath} fill="none" stroke={`url(#${gradientId})`} strokeWidth={3} strokeLinecap="round" />

        {hover && <line x1={hover[0]} y1={0} x2={hover[0]} y2={height} stroke="var(--ink-soft)" strokeWidth={1} />}
      </svg>

      {/* Pontos como HTML por cima do SVG — um <circle> de SVG dentro de um viewBox
          esticado (preserveAspectRatio="none") vira oval, não círculo. */}
      <div
        className={styles.dot}
        style={{
          left: `${(points[points.length - 1][0] / width) * 100}%`,
          top: `${(points[points.length - 1][1] / height) * 100}%`,
          opacity: hoverIndex === null || hoverIndex === points.length - 1 ? 1 : 0.3,
        }}
      />
      {hover && hoverIndex !== points.length - 1 && (
        <div className={`${styles.dot} ${styles.dotActive}`} style={{ left: `${(hover[0] / width) * 100}%`, top: `${(hover[1] / height) * 100}%` }} />
      )}

      {hover && hoverIndex !== null && (
        <div
          className={styles.tooltip}
          style={{ left: `${(hover[0] / width) * 100}%`, top: `${(hover[1] / height) * 100}%` }}
        >
          <div className={styles.tooltipLabel}>{labels?.[hoverIndex] ?? `Ponto ${hoverIndex + 1}`}</div>
          <div className={styles.tooltipValue}>
            {valuePrefix}
            {values[hoverIndex].toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      )}
    </div>
  )
}
