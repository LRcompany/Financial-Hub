const GRADIENT_STOPS = [
  { offset: '0%', color: '#F0605A' },
  { offset: '22%', color: '#F2934A' },
  { offset: '42%', color: '#F0C24B' },
  { offset: '62%', color: '#7FC96B' },
  { offset: '80%', color: '#3FB6A8' },
  { offset: '100%', color: '#3E5BFA' },
]

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
  /** Linha de referência tracejada (ex: meta diária) — omitir quando não fizer sentido (ex: patrimônio). */
  threshold?: number
  height?: number
  gradientId: string
  className?: string
}

export function SmoothLineChart({ values, threshold, height = 90, gradientId, className }: SmoothLineChartProps) {
  const width = 600
  const padY = 10
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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className}>
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

      {thresholdY !== null && (
        <line
          x1={0}
          y1={thresholdY}
          x2={width}
          y2={thresholdY}
          stroke="var(--ink-faint)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      )}

      <path d={areaPath} fill={`url(#${gradientId}-fill)`} stroke="none" />
      <path d={linePath} fill="none" stroke={`url(#${gradientId})`} strokeWidth={3} strokeLinecap="round" />

      {/* ponto final em destaque */}
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={4} fill="var(--accent)" />
    </svg>
  )
}
