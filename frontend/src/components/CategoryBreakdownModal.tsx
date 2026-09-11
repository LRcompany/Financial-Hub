import { useEffect, useState } from 'react'
import { api, type CategoryBreakdown, type CategoryBreakdownRow } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { InstallmentBadge, ProjectedTag, OverBudgetIcon } from './Badge'
import { SpentPlannedValue } from './SpentPlannedValue'
import { ModalShell } from './ModalShell'
import styles from './CategoryBreakdownModal.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** "O que está incluso nesse montante" (pedido do Luiz, 10/09) — abre ao
 * clicar numa categoria (folha) ou num grupo-mãe do Orçamento e lista as
 * transações reais + parcelas projetadas que somam aquele valor. `title` é o
 * nome da categoria/grupo clicado; `categoryIds` são as folhas resolvidas
 * pelo chamador (as que TÊM meta no mês), pra o total bater com a barra. */
export function CategoryBreakdownModal({
  title,
  categoryIds,
  month,
  year,
  planned,
  onClose,
}: {
  title: string
  categoryIds: string[]
  month: number
  year: number
  planned?: number
  onClose: () => void
}) {
  const [data, setData] = useState<CategoryBreakdown | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setData(null)
    setError(false)
    api
      .budgetCategoryBreakdown(categoryIds, month, year)
      .then(setData)
      .catch(() => setError(true))
  }, [categoryIds, month, year])

  const realTotal = data?.transactions.reduce((s, r) => s + r.amount, 0) ?? 0
  const projectedTotal = data?.projected.reduce((s, r) => s + r.amount, 0) ?? 0
  const total = realTotal + projectedTotal
  const isOver = planned != null && planned > 0 && total > planned

  return (
    <ModalShell
      title={
        <>
          {title}
          {isOver && <OverBudgetIcon />}
        </>
      }
      subtitle={
        planned != null && planned > 0 ? (
          <SpentPlannedValue spent={total} planned={planned} suffix="planejado" />
        ) : (
          <Money>{`R$ ${currency(total)}`}</Money>
        )
      }
      onClose={onClose}
    >
      {/* Banner vermelho de verdade (11/09, pedido do Luiz) — frase inteira
          de aviso, diferente da regra de "nunca colorir um valor isolado"
          (SpentPlannedValue continua neutro acima). */}
      {isOver && <div className={styles.overBanner}>Ultrapassou o planejado em <Money>R$ {currency(total - planned!)}</Money>.</div>}

      {error && <div className={styles.empty}>Não consegui carregar o detalhamento.</div>}
      {!error && !data && <div className={styles.empty}>Carregando…</div>}

      {data && (
        <>
          {data.transactions.length > 0 && (
            <div className={styles.block}>
              <div className={styles.blockHead}>
                <span>Gastos confirmados</span>
                <span className={styles.blockHeadValueReal}><Money>R$ {currency(realTotal)}</Money></span>
              </div>
              {data.transactions.map((r) => (
                <Row key={r.id} row={r} />
              ))}
            </div>
          )}

          {data.projected.length > 0 && (
            <div className={styles.block}>
              <div className={styles.blockHead}>
                <span>
                  Parcelas projetadas <ProjectedTag />
                </span>
                <span className={styles.blockHeadValueProjected}><Money>R$ {currency(projectedTotal)}</Money></span>
              </div>
              {data.projected.map((r) => (
                <Row key={r.id} row={r} projected />
              ))}
            </div>
          )}

          {data.transactions.length === 0 && data.projected.length === 0 && (
            <div className={styles.empty}>Nada lançado nessa categoria em {month}/{year}.</div>
          )}
        </>
      )}
    </ModalShell>
  )
}

function Row({ row, projected }: { row: CategoryBreakdownRow; projected?: boolean }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowDesc}>
          {row.description}
          {/* Mesmo badge de "N/Total" usado em toda parcela do app (Dashboard,
              Orçamento, Revisar parcelas) — nunca um estilo próprio novo. */}
          <InstallmentBadge number={row.installmentNumber} total={row.totalInstallments} />
        </span>
        {row.rawDescription && <span className={styles.rowRaw}>{row.rawDescription}</span>}
        <span className={styles.rowMeta}>
          {projected ? 'vence ' : ''}
          {formatDate(row.date)}
          {row.category ? ` · ${row.category}` : ''}
        </span>
      </div>
      <span className={`${styles.rowValue} ${projected ? styles.rowValueProjected : ''}`}><Money>R$ {currency(row.amount)}</Money></span>
    </div>
  )
}
