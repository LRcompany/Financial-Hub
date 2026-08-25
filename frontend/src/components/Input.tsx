import type { InputHTMLAttributes } from 'react'
import styles from './Input.module.css'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

/** Campo de formulário padrão do projeto — único lugar que define tamanho/
 * borda/foco de input. Nunca estilizar um <input> direto fora daqui. */
export function Input({ label, className, ...props }: InputProps) {
  const field = <input className={`${styles.input} ${className ?? ''}`} {...props} />
  if (!label) return field
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {field}
    </label>
  )
}
