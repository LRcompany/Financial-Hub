import { useState, useEffect, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Carousel.module.css'

interface CarouselProps<T> {
  items: T[]
  perPage: number
  keyExtractor: (item: T) => string
  renderItem: (item: T) => ReactNode
  className?: string
}

const CHIP_MIN_WIDTH = 140 // bate com o minmax(140px, 1fr) do grid abaixo

/** `perPage` de tela estreita: cada chip precisa de pelo menos CHIP_MIN_WIDTH,
 * senão o carrossel ultrapassa a borda do card (pedido do Luiz, 07/09 — 6 por
 * página estourava a largura toda no mobile). Nunca aumenta além do `perPage`
 * pedido pelo chamador, só reduz quando a tela não cabe tudo. */
function useResponsivePerPage(requested: number): number {
  const [perPage, setPerPage] = useState(requested)

  useEffect(() => {
    function recompute() {
      // 32px de padding do card (--space-4 de cada lado) + ~64px pras duas
      // setas de navegação — aproximação suficiente, só decide quantas
      // colunas cabem, não precisa ser exato ao pixel.
      const available = window.innerWidth - 96
      const fits = Math.max(1, Math.floor(available / CHIP_MIN_WIDTH))
      setPerPage(Math.min(requested, fits))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [requested])

  return perPage
}

/** Paginação simples (setas + dots) pra lista de chips que não cabe numa
 * linha só — em vez de deixar tudo visível de uma vez (quebrando em várias
 * linhas) ou escondido num scroll horizontal sem indicação nenhuma. Genérico
 * o bastante pra reaproveitar em qualquer lista curta do tipo "N por vez". */
export function Carousel<T>({ items, perPage: requestedPerPage, keyExtractor, renderItem, className }: CarouselProps<T>) {
  const perPage = useResponsivePerPage(requestedPerPage)
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(items.length / perPage)
  // perPage muda (ex: girar o celular, redimensionar) pode deixar a página
  // atual fora do intervalo novo — volta pro início em vez de mostrar vazio.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, totalPages - 1)))
  }, [totalPages])
  const start = page * perPage
  const visible = items.slice(start, start + perPage)

  if (items.length === 0) return null

  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <div className={styles.row}>
        {totalPages > 1 && (
          <button
            className={styles.arrow}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Anterior"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
        )}
        {/* grid-template-columns fixo (repeat(perPage, ...)) em vez do
         * `repeat(auto-fill, minmax(...))` do CSS module — auto-fill dentro
         * de item flex tem bug conhecido do Chromium: a altura intrínseca é
         * calculada como se só 1 coluna coubesse (empilhando os chips todos
         * numa coluna só por baixo dos panos), e essa altura errada "vaza"
         * pro .row inteiro mesmo o grid renderizando visualmente em várias
         * colunas certinho. Com número fixo de colunas o cálculo de altura
         * já sai correto (achado com o carrossel "Por mês" enorme, 04/09). */}
        <div className={styles.items} style={{ gridTemplateColumns: `repeat(${perPage}, minmax(140px, 1fr))` }}>
          {visible.map((item) => (
            <div key={keyExtractor(item)}>{renderItem(item)}</div>
          ))}
        </div>
        {totalPages > 1 && (
          <button
            className={styles.arrow}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            aria-label="Próximo"
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        )}
      </div>
      {totalPages > 1 && (
        <div className={styles.dots}>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              className={`${styles.dot} ${i === page ? styles.dotActive : ''}`}
              onClick={() => setPage(i)}
              aria-label={`Página ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
