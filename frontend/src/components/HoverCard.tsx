import type { ReactNode } from 'react'
import styles from './HoverCard.module.css'

/** Popup de detalhe ao passar o mouse — padrão único de "hover" do projeto,
 * usado em qualquer nome de item de lista que tenha dado extra pra mostrar
 * (posição de ativo, ativo agrupado num gráfico, corretora agrupada...).
 * Se `content` for null (sem dado real pra mostrar), renderiza só o filho,
 * sem popup — nunca mostra um popup vazio. */
export function HoverCard({
  content,
  children,
  className,
}: {
  content: ReactNode | null
  children: ReactNode
  className?: string
}) {
  if (!content) return <>{children}</>
  return (
    <span className={`${styles.trigger} ${className ?? ''}`}>
      {children}
      <span className={styles.popup}>{content}</span>
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
