import { Link } from 'react-router-dom'
import styles from '../styles/cards.module.css'

export function CardHeader({
  icon: Icon,
  title,
  href,
  action,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  title: string
  href?: string
  /** Conteúdo à direita quando não é um link "Ver tudo" (ex: botão de ação
   * específico daquela box, como o upload de extrato da Nomad). */
  action?: React.ReactNode
}) {
  return (
    <div className={styles.cardHeader}>
      <div className={styles.cardHeaderLeft}>
        <Icon size={16} strokeWidth={2} />
        <h2 className={styles.cardTitle}>{title}</h2>
      </div>
      {href && (
        <Link className={styles.cardLink} to={href}>
          Ver tudo
        </Link>
      )}
      {!href && action}
    </div>
  )
}
