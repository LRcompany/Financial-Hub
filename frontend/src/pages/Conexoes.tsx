import { useEffect, useState } from 'react'
import { PluggyConnect } from 'pluggy-connect-sdk'
import { Plus, RefreshCw, Landmark } from 'lucide-react'
import { api, type Broker } from '../lib/api'
import styles from './Conexoes.module.css'

function formatLastSync(iso: string | null) {
  if (!iso) return 'nunca sincronizado'
  return `sincronizado ${new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

export function Conexoes() {
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function loadBrokers() {
    api.brokers().then(setBrokers).catch(() => setError('Não consegui falar com o backend ainda.'))
  }

  useEffect(loadBrokers, [])

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

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Conexões</h1>
        <button className={styles.connectBtn} onClick={() => openWidget()}>
          <Plus size={14} strokeWidth={2} />
          Conectar banco
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {brokers.length === 0 && !error && (
        <div className={styles.emptyState}>Nenhum banco conectado ainda — clique em "Conectar banco" pra começar.</div>
      )}

      <div className={styles.list}>
        {brokers.map((broker) => (
          <div key={broker.id} className={styles.row}>
            <div className={styles.rowIcon}>
              <Landmark size={18} strokeWidth={2} />
            </div>
            <div className={styles.rowBody}>
              <div className={styles.rowName}>{broker.name}</div>
              <div className={styles.rowMeta}>{formatLastSync(broker.lastSyncedAt)}</div>
            </div>
            {broker.dataSource === 'pluggy' && (
              <div className={styles.rowActions}>
                <button className={styles.actionBtn} onClick={() => syncNow(broker)} disabled={busyId === broker.id}>
                  <RefreshCw size={13} strokeWidth={2} className={busyId === broker.id ? styles.spinning : ''} />
                  Sincronizar
                </button>
                <button className={styles.actionBtn} onClick={() => openWidget(broker.pluggyConnectorId ?? undefined)}>
                  Reconectar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
