import type { CSSProperties } from 'react'
import { currency } from '../lib/format'
import { Money } from './Money'
import { HoverCard, HoverRow } from './HoverCard'
import styles from './DividendsByMonthChart.module.css'

interface MonthDividends {
  label: string
  acao: number
  fii: number
  /** Lançamento manual (11/09, botão "+ Rendimento" — pedido do Luiz pro
   * fundo VALORA, que a Pluggy não reporta dividendo). Mesma soma agregada
   * de Ação/FII, terceira cor empilhada. */
  fundo: number
  /** De onde veio a grana naquele mês, maior primeiro (pedido do Luiz,
   * 11/09: "quando eu passar o mouse em proventos, quero saber de onde veio
   * a grana") — vazio quando nenhum ativo pagou nesse mês. */
  breakdown: { label: string; value: number }[]
}

/** Barra empilhada Ação+FII+Fundo por mês (pedido do Luiz, 11/09: "gráfico
 * por mês do ano... preciso ver o que veio do FII e o que veio da ação";
 * Fundo — lançamento manual — entrou depois, mesmo dia) + linha de
 * acumulado no ano (14/09, pedido do Luiz depois de lançar os rendimentos
 * do VALORA: "adicionar no gráfico uma linha a mais mostrando esses
 * rendimentos e o que já recebi até então"). Mesmo padrão visual do
 * `VerticalBarChart` (barra vertical full-width, vira linha horizontal em
 * tela estreita) — só com cores empilhadas em vez de uma, porque aqui a cor
 * É a informação (qual tipo de ativo rendeu), não decoração. Cores fixas
 * (não cicladas por índice, diferente do `ClientPieChart`) — cada série
 * precisa ser sempre a MESMA cor em todo mês, senão a legenda não serve pra
 * nada.
 *
 * A linha de acumulado usa escala PRÓPRIA (nunca a mesma da barra — o total
 * do ano é muito maior que qualquer mês isolado, ia ficar colada no topo o
 * tempo todo) e só existe no layout de coluna vertical (desktop): no mobile
 * a "coluna" vira LINHA horizontal (mesmo padrão de `VerticalBarChart`),
 * eixo inteiro gira 90°, então uma linha desenhada pro eixo vertical não faz
 * sentido geométrico ali — a área do gráfico esconde a linha nesse
 * breakpoint (`.lineOverlay { display: none }` no CSS), o total acumulado
 * continua disponível no hover de cada mês e no "recebido no ano" logo
 * abaixo do gráfico. */
export function DividendsByMonthChart({ data }: { data: MonthDividends[] }) {
  const monthTotals = data.map((d) => d.acao + d.fii + d.fundo)
  const maxValue = Math.max(...monthTotals, 1)

  const cumulative: number[] = []
  monthTotals.reduce((sum, v, i) => (cumulative[i] = sum + v), 0)
  const cumulativeMax = cumulative[cumulative.length - 1] || 1

  const points = cumulative.map((v, i) => ({
    xPct: ((i + 0.5) / data.length) * 100,
    yPct: 100 - (v / cumulativeMax) * 100,
    value: v,
  }))
  const linePoints = points.map((p) => `${p.xPct},${p.yPct}`).join(' ')

  return (
    <div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: 'var(--accent)' }} />
          Ação
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: 'var(--dividends-fii)' }} />
          FII
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: 'var(--dividends-fundo)' }} />
          Fundo
        </span>
        {/* Some junto com a linha no mobile (ver CSS) — a coluna vertical
            vira linha horizontal nesse breakpoint, eixo gira 90°, a linha
            de acumulado não faz mais sentido geométrico ali. */}
        <span className={`${styles.legendItem} ${styles.legendItemLine}`}>
          <span className={styles.legendLine} />
          Acumulado no ano
        </span>
      </div>
      <div className={styles.chart}>
        <svg className={styles.lineOverlay} viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={linePoints} fill="none" vectorEffect="non-scaling-stroke" className={styles.lineStroke} />
        </svg>
        {points.map((p, i) => (
          <span key={i} className={styles.lineDot} style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }} />
        ))}
        {data.map((d, i) => {
          const total = monthTotals[i]
          return (
            <div key={d.label} className={styles.col} title={`R$ ${currency(total)}`}>
              <span className={styles.value}>{total > 0 ? <Money>{`R$ ${currency(total)}`}</Money> : ''}</span>
              <div className={styles.bar}>
                {d.fundo > 0 && (
                  <div
                    className={styles.segment}
                    style={{ '--seg-size': `${(d.fundo / maxValue) * 100}%`, background: 'var(--dividends-fundo)' } as CSSProperties}
                  />
                )}
                {d.fii > 0 && (
                  <div
                    className={styles.segment}
                    style={{ '--seg-size': `${(d.fii / maxValue) * 100}%`, background: 'var(--dividends-fii)' } as CSSProperties}
                  />
                )}
                {d.acao > 0 && (
                  <div
                    className={styles.segment}
                    style={{ '--seg-size': `${(d.acao / maxValue) * 100}%`, background: 'var(--accent)' } as CSSProperties}
                  />
                )}
              </div>
              <HoverCard
                content={
                  <>
                    {d.breakdown.map((b) => (
                      <HoverRow key={b.label} label={b.label} value={<Money>{`R$ ${currency(b.value)}`}</Money>} />
                    ))}
                    <HoverRow label="Acumulado no ano até aqui" value={<Money>{`R$ ${currency(cumulative[i])}`}</Money>} />
                  </>
                }
              >
                <span className={styles.label}>{d.label}</span>
              </HoverCard>
            </div>
          )
        })}
      </div>
    </div>
  )
}
