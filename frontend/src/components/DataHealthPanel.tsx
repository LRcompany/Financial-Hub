import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, AlertTriangle, Info } from 'lucide-react'
import { api, type DataHealth } from '../lib/api'
import cards from '../styles/cards.module.css'
import styles from './DataHealthPanel.module.css'

/** "Saúde dos dados" (27/10, pedido do Luiz: "não quero depois de 2 meses de
 * uso falar pra você verificar os números novamente"). Mostra as regras de
 * integridade que o servidor confere todo dia — erro primeiro, depois aviso,
 * cada um com o que exatamente quebrou. Tudo certo = uma linha verde só. */
export function DataHealthPanel() {
  const [health, setHealth] = useState<DataHealth | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.dataHealth().then(setHealth).catch(() => setError(true))
  }, [])

  if (error) return <div className={cards.card}><div className={cards.emptyState}>Não consegui conferir os dados agora.</div></div>
  if (!health) return <div className={cards.card}><div className={cards.emptyState}>Conferindo os dados…</div></div>

  const checked = new Date(health.checkedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const sorted = [...health.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'erro' ? -1 : 1))

  return (
    <div className={cards.card}>
      <div className={styles.header}>
        {health.issues.length === 0 ? (
          <span className={styles.ok}><ShieldCheck size={16} strokeWidth={2} /> Tudo certo com os dados</span>
        ) : health.ok ? (
          <span className={styles.warn}><ShieldAlert size={16} strokeWidth={2} /> Números certos, {health.issues.length} aviso{health.issues.length === 1 ? '' : 's'}</span>
        ) : (
          <span className={styles.bad}><ShieldAlert size={16} strokeWidth={2} /> Tem número errado — veja abaixo</span>
        )}
        <span className={styles.checked}>conferido em {checked}</span>
      </div>
      {sorted.map((issue) => (
        <div key={issue.id} className={styles.issue}>
          <div className={styles.issueTitle}>
            {issue.severity === 'erro' ? <AlertTriangle size={14} strokeWidth={2} className={styles.iconBad} /> : <Info size={14} strokeWidth={2} className={styles.iconWarn} />}
            {issue.title}
          </div>
          <p className={styles.detail}>{issue.detail}</p>
          <ul className={styles.items}>
            {issue.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
