import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type CategoryBreakdown, type CategoryBreakdownRow } from '../lib/api'
import { currency } from '../lib/format'
import { IconButton } from './IconButton'
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>{title}</h3>
            <p className={styles.subtitle}>
              R$ {currency(total)}
              {planned != null && planned > 0 && (
                <span className={isOver ? styles.overText : undefined}> / R$ {currency(planned)} planejado</span>
              )}
            </p>
          </div>
          <IconButton aria-label="Fechar" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </IconButton>
        </div>

        {isOver && (
          <div className={styles.overBanner}>Ultrapassou o planejado em R$ {currency(total - planned!)}.</div>
        )}

        {error && <div className={styles.empty}>Não consegui carregar o detalhamento.</div>}
        {!error && !data && <div className={styles.empty}>Carregando…</div>}

        {data && (
          <>
            {data.transactions.length > 0 && (
              <div className={styles.block}>
                <div className={styles.blockHead}>
                  <span>Gastos confirmados</span>
                  <span>R$ {currency(realTotal)}</span>
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
                    Parcelas projetadas <span className={styles.pill}>projetado</span>
                  </span>
                  <span>R$ {currency(projectedTotal)}</span>
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
      </div>
    </div>
  )
}

function Row({ row, projected }: { row: CategoryBreakdownRow; projected?: boolean }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowDesc}>
          {row.description}
          {row.installmentNumber && row.totalInstallments ? (
            <span className={styles.rowInst}>
              {' '}
              {row.installmentNumber}/{row.totalInstallments}
            </span>
          ) : null}
        </span>
        {row.rawDescription && <span className={styles.rowRaw}>{row.rawDescription}</span>}
        <span className={styles.rowMeta}>
          {projected ? 'vence ' : ''}
          {formatDate(row.date)}
          {row.category ? ` · ${row.category}` : ''}
        </span>
      </div>
      <span className={styles.rowValue}>R$ {currency(row.amount)}</span>
    </div>
  )
}
