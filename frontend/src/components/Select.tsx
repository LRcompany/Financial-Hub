import type { SelectHTMLAttributes } from 'react'
import styles from './Input.module.css'

/** Mesmo estilo do <Input> (mesma classe .input) — um <select> é um campo de
 * formulário igual, não faz sentido ter dois tamanhos diferentes no app. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${styles.input} ${className ?? ''}`} {...props}>
      {children}
    </select>
  )
}
