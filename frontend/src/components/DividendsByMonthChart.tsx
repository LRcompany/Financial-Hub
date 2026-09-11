import type { CSSProperties } from 'react'
import { currency } from '../lib/format'
import styles from './DividendsByMonthChart.module.css'

interface MonthDividends {
  label: string
  acao: number
  fii: number
}

/** Barra empilhada Ação+FII por mês (pedido do Luiz, 11/09: "gráfico por mês
 * do ano... preciso ver o que veio do FII e o que veio da ação"). Mesmo
 * padrão visual do `VerticalBarChart` (barra vertical full-width, vira linha
 * horizontal em tela estreita) — só com duas cores empilhadas em vez de uma,
 * porque aqui a cor É a informação (qual ativo rendeu), não decoração. Cores
 * fixas (não cicladas por índice, diferente do `ClientPieChart`) — Ação e
 * FII precisam ser sempre a MESMA cor em todo mês, senão a legenda não serve
 * pra nada. */
export function DividendsByMonthChart({ data }: { data: MonthDividends[] }) {
  const maxValue = Math.max(...data.map((d) => d.acao + d.fii), 1)

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
      </div>
      <div className={styles.chart}>
        {data.map((d) => {
          const total = d.acao + d.fii
          return (
            <div key={d.label} className={styles.col} title={`R$ ${currency(total)}`}>
              <span className={styles.value}>{total > 0 ? `R$ ${currency(total)}` : ''}</span>
              <div className={styles.bar}>
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
              <span className={styles.label}>{d.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
