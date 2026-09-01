import { useEffect, useState } from 'react'
import { PluggyConnect } from 'pluggy-connect-sdk'
import { Plus, RefreshCw, Landmark, Target, FileUp, Trash2 } from 'lucide-react'
import { api, type Broker, type DailyGoalEntry } from '../lib/api'
import { CardHeader } from '../components/CardHeader'
import { Input } from '../components/Input'
import { StatementUploadModal } from '../components/StatementUploadModal'
import { currency } from '../lib/format'
import cards from '../styles/cards.module.css'
import styles from './Settings.module.css'

// Corretoras "manual_statement" que já têm um parser de extrato ligado
// (formato Apex Clearing) — as outras (Binance, XP, Órama...) continuam sem
// botão de upload até terem um parser próprio, pra não abrir um fluxo que
// nunca extrai nada.
const STATEMENT_UPLOAD_BROKERS = new Set(['NOMAD', 'INCO'])

function formatLastSync(iso: string | null) {
  if (!iso) return 'nunca sincronizado'
  return `sincronizado ${new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function Settings() {
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleteErrorId, setDeleteErrorId] = useState<{ id: string; message: string } | null>(null)
  const [uploadTarget, setUploadTarget] = useState<{ id: string; name: string } | null>(null)

  const [dailyGoals, setDailyGoals] = useState<DailyGoalEntry[]>([])
  const [dailyGoalInput, setDailyGoalInput] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)

  function loadBrokers() {
    api.brokers().then(setBrokers).catch(() => setError('Não consegui falar com o backend ainda.'))
  }

  function loadDailyGoals() {
    api.dailyGoalHistory().then(setDailyGoals).catch(() => {})
  }

  useEffect(() => {
    loadBrokers()
    loadDailyGoals()
  }, [])

  // Abre o widget oficial da Pluggy — o login bancário (senha, MFA) acontece
  // inteiramente dentro do iframe deles, nunca passa por aqui.
  async function openWidget(itemId?: string) {
    setError(null)
    try {
      const { accessToken } = await api.pluggyConnectToken(itemId)
      const widget = new PluggyConnect({
        connectToken: accessToken,
        updateItem: itemId,
        includeSandbox: false,
        onSuccess: async ({ item }) => {
          await api.linkPluggyBroker(item.id, item.connector.name)
          loadBrokers()
        },
        onError: (err) => setError(`Falha na conexão: ${err.message}`),
      })
      widget.init()
    } catch (err) {
      setError(`Não consegui iniciar a conexão: ${(err as Error).message}`)
    }
  }

  async function syncNow(broker: Broker) {
    setBusyId(broker.id)
    setError(null)
    try {
      await api.syncBroker(broker.id)
      loadBrokers()
    } catch (err) {
      setError(`Falha ao sincronizar ${broker.name}: ${(err as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function deleteBroker(broker: Broker) {
    if (confirmDeleteId !== broker.id) {
      setConfirmDeleteId(broker.id)
      setDeleteErrorId(null)
      return
    }
    setBusyId(broker.id)
    setDeleteErrorId(null)
    try {
      await api.deleteBroker(broker.id)
      setConfirmDeleteId(null)
      loadBrokers()
    } catch (err) {
      setDeleteErrorId({ id: broker.id, message: (err as Error).message })
      setConfirmDeleteId(null)
    } finally {
      setBusyId(null)
    }
  }

  async function saveDailyGoal(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(dailyGoalInput)
    if (!amount || amount <= 0) return
    setSavingGoal(true)
    try {
      await api.setDailyGoal(amount)
      setDailyGoalInput('')
      loadDailyGoals()
    } finally {
      setSavingGoal(false)
    }
  }

  const currentGoal = dailyGoals[0] ?? null

  return (
    <div className={cards.page}>
      <h1 className={styles.pageTitle}>Configurações</h1>

      {/* ---------- Variáveis fixas ---------- */}
      <section>
        <h2 className={cards.sectionTitle}>Variáveis fixas</h2>
        <div className={cards.card}>
          <CardHeader icon={Target} title="Meta diária de gasto" />
          <p className={styles.helperText}>
            Mudar a meta não reescreve o passado — a meta nova vale só a partir de hoje. Dias anteriores continuam
            avaliados pela meta que estava em vigor neles.
          </p>

          <div className={styles.currentGoal}>
            <span className={cards.heroLabel}>Vigente desde {currentGoal ? formatDate(currentGoal.effectiveFrom) : '—'}</span>
            <span className={cards.heroValue} style={{ fontSize: '1.4rem' }}>
              {currentGoal ? `R$ ${currency(currentGoal.amount)}` : 'não definida'}
            </span>
          </div>

          <form className={styles.inlineForm} onSubmit={saveDailyGoal}>
            <Input
              type="number"
              step="0.01"
              placeholder="Nova meta diária (R$)"
              value={dailyGoalInput}
              onChange={(e) => setDailyGoalInput(e.target.value)}
            />
            <button className={cards.saveBtn} type="submit" disabled={savingGoal}>
              Salvar a partir de hoje
            </button>
          </form>

          {dailyGoals.length > 1 && (
            <>
              <h3 className={styles.subheading}>Histórico</h3>
              <div className={styles.historyList}>
                {dailyGoals.map((g) => (
                  <div key={g.id} className={styles.historyRow}>
                    <span>R$ {currency(g.amount)}</span>
                    <span className={cards.heroLabel}>desde {formatDate(g.effectiveFrom)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---------- Conexões ---------- */}
      <section>
        <h2 className={cards.sectionTitle}>Conexões</h2>
        <div className={styles.headerRow}>
          <button className={styles.connectBtn} onClick={() => openWidget()}>
            <Plus size={14} strokeWidth={2} />
            Conectar banco
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {brokers.length === 0 && !error && (
          <div className={cards.emptyState}>Nenhum banco conectado ainda — clique em "Conectar banco" pra começar.</div>
        )}

        <div className={styles.list}>
          {brokers.map((broker) => {
            const canUploadStatement = broker.dataSource === 'manual_statement' && STATEMENT_UPLOAD_BROKERS.has(broker.name)
            const isConfirming = confirmDeleteId === broker.id
            const deleteError = deleteErrorId?.id === broker.id ? deleteErrorId.message : null
            return (
              <div key={broker.id} className={styles.row}>
                <div className={styles.rowIcon}>
                  <Landmark size={18} strokeWidth={2} />
                </div>
                <div className={styles.rowBody}>
                  <div className={styles.rowName}>{broker.name}</div>
                  <div className={styles.rowMeta}>{formatLastSync(broker.lastSyncedAt)}</div>
                  {deleteError && <div className={styles.error} style={{ marginTop: 6 }}>{deleteError}</div>}
                </div>
                <div className={styles.rowActions}>
                  {broker.dataSource === 'pluggy' && (
                    <>
                      <button className={styles.actionBtn} onClick={() => syncNow(broker)} disabled={busyId === broker.id}>
                        <RefreshCw size={13} strokeWidth={2} className={busyId === broker.id ? styles.spinning : ''} />
                        Sincronizar
                      </button>
                      <button className={styles.actionBtn} onClick={() => openWidget(broker.pluggyConnectorId ?? undefined)}>
                        Reconectar
                      </button>
                    </>
                  )}
                  {broker.dataSource === 'onchain_query' && (
                    <button className={styles.actionBtn} onClick={() => syncNow(broker)} disabled={busyId === broker.id}>
                      <RefreshCw size={13} strokeWidth={2} className={busyId === broker.id ? styles.spinning : ''} />
                      Sincronizar
                    </button>
                  )}
                  {canUploadStatement && (
                    <button className={styles.actionBtn} onClick={() => setUploadTarget({ id: broker.id, name: broker.name })}>
                      <FileUp size={13} strokeWidth={2} />
                      Atualizar por extrato
                    </button>
                  )}
                  <button
                    className={isConfirming ? styles.deleteBtnConfirm : styles.deleteBtn}
                    onClick={() => deleteBroker(broker)}
                    disabled={busyId === broker.id}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                    {isConfirming ? 'Confirmar exclusão?' : 'Excluir'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {uploadTarget && (
        <StatementUploadModal
          brokerId={uploadTarget.id}
          brokerName={uploadTarget.name}
          onClose={() => setUploadTarget(null)}
          onSaved={() => {
            setUploadTarget(null)
            loadBrokers()
          }}
        />
      )}
    </div>
  )
}
