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
 * Fundo — lançamento manual — entrou depois, mesmo dia). Mesmo padrão
 * visual do `VerticalBarChart` (barra vertical full-width, vira linha
 * horizontal em tela estreita) — só com cores empilhadas em vez de uma,
 * porque aqui a cor É a informação (qual tipo de ativo rendeu), não
 * decoração. Cores fixas (não cicladas por índice, diferente do
 * `ClientPieChart`) — cada série precisa ser sempre a MESMA cor em todo
 * mês, senão a legenda não serve pra nada. */
export function DividendsByMonthChart({ data }: { data: MonthDividends[] }) {
  const maxValue = Math.max(...data.map((d) => d.acao + d.fii + d.fundo), 1)

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
      </div>
      <div className={styles.chart}>
        {data.map((d) => {
          const total = d.acao + d.fii + d.fundo
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
                  d.breakdown.length > 0
                    ? d.breakdown.map((b) => <HoverRow key={b.label} label={b.label} value={<Money>{`R$ ${currency(b.value)}`}</Money>} />)
                    : null
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
