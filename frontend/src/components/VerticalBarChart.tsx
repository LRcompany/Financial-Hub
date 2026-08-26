import { currency } from '../lib/format'
import { HoverCard, HoverRow } from './HoverCard'
import styles from './VerticalBarChart.module.css'

interface Item {
  label: string
  value: number
  /** Quando esse item agrupa mais de uma posição (ex: mesmo ticker em duas
   * corretoras, ou o bucket "Outros"), mostra o detalhe no hover. */
  breakdown?: { label: string; value: number }[]
}

/** Barras verticais, 100% da largura — todas em tom neutro, sem "vencedor"
 * fixo (os itens não têm relação de ranking entre si, destacar o maior
 * sugeria uma hierarquia que não existe). O destaque é só de interação: a
 * barra sob o mouse marca em --accent (ver VerticalBarChart.module.css,
 * :hover). Escala melhor que pizza quando tem muito ativo (Ação/FII), e
 * cabe mais opção que a versão horizontal por ser full-width. `max` alto o
 * bastante pra não truncar em "Outros" nos casos reais — a barra estreita
 * sozinha via flex quando tem muita coluna, não precisa cortar informação
 * por falta de espaço. */
export function VerticalBarChart({ data, max = 20 }: { data: Item[]; max?: number }) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, d) => sum + d.value, 0)
  const visible = sorted.slice(0, max)
  const restTotal = sorted.slice(max).reduce((sum, d) => sum + d.value, 0)
  const bars = restTotal > 0 ? [...visible, { label: 'Outros', value: restTotal, breakdown: sorted.slice(max) }] : visible
  const maxValue = Math.max(...bars.map((b) => b.value), 1)
  // Da esquerda pra direita: menor -> maior (inverte a ordenação decrescente
  // usada só pra truncar "Outros").
  const ordered = [...bars].reverse()

  return (
    <div className={styles.chart}>
      {ordered.map((b) => (
        <div key={b.label} className={styles.col}>
          <span className={styles.pct}>{((b.value / total) * 100).toFixed(1)}%</span>
          <div
            className={styles.bar}
            style={{ height: `${Math.max((b.value / maxValue) * 100, 6)}%` }}
            title={`R$ ${currency(b.value)}`}
          />
          <HoverCard
            content={
              b.breakdown && b.breakdown.length > 1
                ? b.breakdown.map((d) => <HoverRow key={d.label} label={d.label} value={`R$ ${currency(d.value)}`} />)
                : null
            }
          >
            <span className={styles.label}>{b.label}</span>
          </HoverCard>
        </div>
      ))}
    </div>
  )
}
