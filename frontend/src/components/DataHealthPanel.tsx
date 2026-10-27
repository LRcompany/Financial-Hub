import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, AlertTriangle, Info } from 'lucide-react'
import { api, type DataHealth, type DataHealthIssue, type DataHealthItem, type LeafCategoryOption } from '../lib/api'
import { Select } from './Select'
import { ManualPositionsModal } from './ManualPositionsModal'
import cards from '../styles/cards.module.css'
import styles from './DataHealthPanel.module.css'

// Avisos de "revisar" onde o item é um lançamento repetido — dá pra apagar.
const DELETABLE = new Set(['manual-repete-pluggy', 'pluggy-repetido'])

/** "Saúde dos dados" (27/10, pedido do Luiz: "não quero depois de 2 meses de
 * uso falar pra você verificar os números novamente"). Mostra as regras de
 * integridade que o servidor confere todo dia — erro primeiro, depois aviso,
 * cada um com o que exatamente quebrou. Tudo certo = uma linha verde só.
 *
 * Todo aviso vem com o botão que resolve ali mesmo ("mas e aí, o que eu faço
 * com isso?"): Corrigir agora (o app conserta sozinho), Categorizar, Atualizar
 * valor (corretora manual), Reconectar (banco), ou — quando só o Luiz sabe —
 * Apagar o repetido / É assim mesmo. */
export function DataHealthPanel() {
  const [health, setHealth] = useState<DataHealth | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [categories, setCategories] = useState<LeafCategoryOption[]>([])
  const [brokerTarget, setBrokerTarget] = useState<{ id: string; name: string } | null>(null)

  const load = () => api.dataHealth().then(setHealth).catch(() => setError(true))
  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    if (health?.issues.some((i) => i.action === 'categorize') && categories.length === 0) {
      api.transactionLeafCategories().then(setCategories).catch(() => {})
    }
  }, [health, categories.length])

  async function run(key: string, action: () => Promise<{ health: DataHealth } | unknown>) {
    setBusy(key)
    setActionError(null)
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'health' in result) setHealth((result as { health: DataHealth }).health)
      else await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Não deu certo — tente de novo.')
    } finally {
      setBusy(null)
    }
  }

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
      {actionError && <p className={styles.actionError}>{actionError}</p>}
      {sorted.map((issue) => (
        <div key={issue.id} className={styles.issue}>
          <div className={styles.issueHead}>
            <div>
              <div className={styles.issueTitle}>
                {issue.severity === 'erro' ? <AlertTriangle size={14} strokeWidth={2} className={styles.iconBad} /> : <Info size={14} strokeWidth={2} className={styles.iconWarn} />}
                {issue.title}
              </div>
              <p className={styles.detail}>{issue.detail}</p>
            </div>
            {issue.action === 'auto-fix' && (
              <button type="button" className={styles.primaryBtn} disabled={busy !== null} onClick={() => run(issue.id, () => api.fixDataHealth(issue.id))}>
                {busy === issue.id ? 'Corrigindo…' : 'Corrigir agora'}
              </button>
            )}
            {issue.action === 'reconnect' && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => document.getElementById('conexoes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Reconectar
              </button>
            )}
          </div>
          <ul className={styles.items}>
            {issue.items.map((it) => (
              <li key={it.key} className={styles.item}>
                <span className={styles.itemLabel}>{it.label}</span>
                <ItemActions
                  issue={issue}
                  item={it}
                  busy={busy}
                  categories={categories}
                  onRun={run}
                  onUpdateBroker={(id, name) => setBrokerTarget({ id, name })}
                />
              </li>
            ))}
            {issue.total > issue.items.length && <li className={styles.more}>+ {issue.total - issue.items.length} outros{issue.action === 'auto-fix' ? ' (o "Corrigir agora" resolve todos)' : ''}</li>}
          </ul>
        </div>
      ))}
      {brokerTarget && (
        <ManualPositionsModal
          brokerId={brokerTarget.id}
          brokerName={brokerTarget.name}
          onClose={() => setBrokerTarget(null)}
          onSaved={() => {
            setBrokerTarget(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function ItemActions({
  issue,
  item,
  busy,
  categories,
  onRun,
  onUpdateBroker,
}: {
  issue: DataHealthIssue
  item: DataHealthItem
  busy: string | null
  categories: LeafCategoryOption[]
  onRun: (key: string, action: () => Promise<unknown>) => void
  onUpdateBroker: (id: string, name: string) => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const ref = item.ref
  if (!ref) return null
  const disabled = busy !== null

  if (issue.action === 'categorize') {
    return (
      <span className={styles.itemActions}>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={styles.categorySelect} disabled={disabled}>
          <option value="">— categoria —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!categoryId || disabled}
          onClick={() => onRun(item.key, () => api.categorizeDataHealthItems([ref], categoryId))}
        >
          {busy === item.key ? 'Salvando…' : 'Salvar'}
        </button>
      </span>
    )
  }
  if (issue.action === 'update-broker') {
    return (
      <span className={styles.itemActions}>
        <button type="button" className={styles.primaryBtn} onClick={() => onUpdateBroker(ref.id, item.label.split(' — ')[0])}>
          Atualizar valor
        </button>
      </span>
    )
  }
  if (issue.action === 'review') {
    // Divisão que não fecha não tem "é assim mesmo": a soma TEM que bater.
    if (!DELETABLE.has(issue.id)) return null
    return (
      <span className={styles.itemActions}>
        <button
          type="button"
          className={styles.secondaryBtn}
          disabled={disabled}
          onClick={() => {
            if (window.confirm(`Apagar "${item.label}"? Não dá pra desfazer.`)) onRun(item.key, () => api.deleteTransaction(ref.id))
          }}
        >
          Apagar o repetido
        </button>
        <button type="button" className={styles.secondaryBtn} disabled={disabled} onClick={() => onRun(item.key, () => api.ignoreDataHealthItem(item.key))}>
          É assim mesmo
        </button>
      </span>
    )
  }
  return null
}
