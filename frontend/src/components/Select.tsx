import type { SelectHTMLAttributes } from 'react'
import styles from './Input.module.css'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

/** Mesmo estilo do <Input> (mesma classe .input) — um <select> é um campo de
 * formulário igual, não faz sentido ter dois tamanhos diferentes no app.
 * `label` espelha o <Input>: mesmo wrapper `.field` (flex:1, min-width:160px)
 * — é o que faz o campo participar direito do flex-wrap de um formRow em vez
 * de forçar scroll horizontal. Prefira sempre usar `label` num campo de
 * formulário de verdade (não numa célula de tabela compacta). */
export function Select({ label, className, children, ...props }: SelectProps) {
  const field = (
    <select className={`${styles.input} ${className ?? ''}`} {...props}>
      {children}
    </select>
  )
  if (!label) return field
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {field}
    </label>
  )
}
