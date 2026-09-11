import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './HoverCard.module.css'

/** Popup de detalhe ao passar o mouse — padrão único de "hover" do projeto,
 * usado em qualquer nome de item de lista que tenha dado extra pra mostrar
 * (posição de ativo, ativo agrupado num gráfico, corretora agrupada...).
 * Se `content` for null (sem dado real pra mostrar), renderiza só o filho,
 * sem popup — nunca mostra um popup vazio.
 *
 * Renderiza o popup num PORTAL pra `document.body` (11/09 — achado real:
 * o popup antigo era filho absoluto do próprio trigger, e qualquer ancestral
 * com `overflow-x/y` diferente de `visible` no meio do caminho (ex:
 * `.tableWrap { overflow-x: auto }`, que por regra do CSS também vira
 * `overflow-y: auto` implicitamente) CORTAVA o popup — ele aparecia
 * espremido/sobreposto nas linhas da tabela em vez de flutuar por cima de
 * tudo). Com portal + `position: fixed` calculado a partir do
 * `getBoundingClientRect()` do gatilho, o popup escapa de QUALQUER
 * ancestral com scroll, sem precisar caçar e destravar overflow um por um. */
export function HoverCard({
  content,
  children,
  className,
}: {
  content: ReactNode | null
  children: ReactNode
  className?: string
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (!content) return <>{children}</>

  function show() {
    if (hideTimeout.current) clearTimeout(hideTimeout.current)
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    // Um frame depois de montar (posição já aplicada) — dispara a
    // transição de opacity/transform em vez de aparecer seco.
    requestAnimationFrame(() => setVisible(true))
  }

  function hide() {
    setVisible(false)
    hideTimeout.current = setTimeout(() => setPos(null), 150)
  }

  return (
    <span ref={triggerRef} className={`${styles.trigger} ${className ?? ''}`} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos &&
        createPortal(
          <span
            className={`${styles.popup} ${visible ? styles.popupVisible : ''}`}
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  )
}

/** Uma linha rótulo/valor dentro do popup — reutilizada em todo hover do projeto. */
export function HoverRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span>{value}</span>
    </div>
  )
}
