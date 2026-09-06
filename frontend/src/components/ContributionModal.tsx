import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type Broker, type ContributionAsset } from '../lib/api'
import { Input } from './Input'
import { Select } from './Select'
import styles from './ContributionModal.module.css'

const SECURITY_TYPES = ['Renda Fixa', 'Fundo', 'Ação', 'FII', 'Cripto', 'Moeda', 'Outro']

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Modal "Registrar aporte" (05/09) — registra dinheiro que entrou/saiu de
 * verdade, em vez de inferir isso por diferença de valor de mercado (raiz dos
 * 2 bugs de câmbio/Ação-FII corrigidos no mesmo dia). Escolhe um ativo já
 * cadastrado (já traz corretora/moeda) ou cria ativo novo — e corretora nova
 * junto, se precisar. O backend soma isso no `investedAmount` travado da
 * posição (delta, não substitui — ver services/contributions.ts). */
export function ContributionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true)
  const [assets, setAssets] = useState<ContributionAsset[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [assetMode, setAssetMode] = useState<'existing' | 'new'>('existing')
  const [assetKey, setAssetKey] = useState<string>('') // `${brokerId}:${securityId}`

  const [newName, setNewName] = useState('')
  const [newTicker, setNewTicker] = useState('')
  const [newType, setNewType] = useState('Ação')
  const [newCurrency, setNewCurrency] = useState<'BRL' | 'USD'>('BRL')

  const [brokerMode, setBrokerMode] = useState<'existing' | 'new'>('existing')
  const [brokerId, setBrokerId] = useState('')
  const [newBrokerName, setNewBrokerName] = useState('')

  const [kind, setKind] = useState<'aporte' | 'resgate'>('aporte')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')

  useEffect(() => {
    Promise.all([api.contributionAssets(), api.brokers()])
      .then(([a, b]) => {
        setAssets(a)
        setBrokers(b.filter((br) => !br.archivedAt))
        if (a.length > 0) setAssetKey(`${a[0].brokerId}:${a[0].securityId}`)
        if (b.length > 0) setBrokerId(b[0].id)
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const selectedAsset = assets.find((a) => `${a.brokerId}:${a.securityId}` === assetKey) ?? null
  const currency: 'BRL' | 'USD' = assetMode === 'existing' ? (selectedAsset?.currency === 'USD' ? 'USD' : 'BRL') : newCurrency

  async function handleSave() {
    setError(null)
    const parsed = Number(amount)
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setError('Digite um valor maior que zero.')
      return
    }
    if (assetMode === 'existing' && !selectedAsset) {
      setError('Escolha um ativo.')
      return
    }
    if (assetMode === 'new' && !newName.trim()) {
      setError('Digite o nome do ativo novo.')
      return
    }
    if (brokerMode === 'new' && !newBrokerName.trim()) {
      setError('Digite o nome da corretora nova.')
      return
    }
    if (brokerMode === 'existing' && !brokerId && assetMode === 'new') {
      setError('Escolha a corretora.')
      return
    }

    const signedAmount = kind === 'resgate' ? -Math.abs(parsed) : Math.abs(parsed)

    setSaving(true)
    try {
      await api.createContribution({
        securityId: assetMode === 'existing' ? selectedAsset!.securityId : undefined,
        newSecurity:
          assetMode === 'new'
            ? { name: newName.trim(), ticker: newTicker.trim() || undefined, type: newType, currency: newCurrency }
            : undefined,
        brokerId: assetMode === 'existing' ? selectedAsset!.brokerId : brokerMode === 'existing' ? brokerId : undefined,
        newBroker: assetMode === 'new' && brokerMode === 'new' ? { name: newBrokerName.trim() } : undefined,
        amount: signedAmount,
        currency,
        date,
        note: note.trim() || undefined,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Registrar aporte</h3>
            <p className={styles.subtitle}>Dinheiro que entrou (ou saiu) de verdade — soma no valor investido travado do ativo.</p>
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {loading ? (
          <p className={styles.helperText}>Carregando...</p>
        ) : (
          <>
            <div className={styles.segmented}>
              <button className={assetMode === 'existing' ? styles.segActive : styles.seg} onClick={() => setAssetMode('existing')}>
                Ativo existente
              </button>
              <button className={assetMode === 'new' ? styles.segActive : styles.seg} onClick={() => setAssetMode('new')}>
                + Novo ativo
              </button>
            </div>

            {assetMode === 'existing' ? (
              assets.length === 0 ? (
                <p className={styles.helperText}>Nenhum ativo ativo encontrado — use "+ Novo ativo".</p>
              ) : (
                <Select label="Ativo" value={assetKey} onChange={(e) => setAssetKey(e.target.value)}>
                  {assets.map((a) => (
                    <option key={`${a.brokerId}:${a.securityId}`} value={`${a.brokerId}:${a.securityId}`}>
                      {a.brokerName} — {a.securityName} ({a.currency})
                    </option>
                  ))}
                </Select>
              )
            ) : (
              <>
                <div className={styles.formRow}>
                  <Input label="Nome do ativo" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: WEGE3" />
                  <Input label="Ticker (opcional)" value={newTicker} onChange={(e) => setNewTicker(e.target.value)} />
                </div>
                <div className={styles.formRow}>
                  <Select label="Tipo" value={newType} onChange={(e) => setNewType(e.target.value)}>
                    {SECURITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                  <Select label="Moeda" value={newCurrency} onChange={(e) => setNewCurrency(e.target.value as 'BRL' | 'USD')}>
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                  </Select>
                </div>

                <div className={styles.segmented}>
                  <button className={brokerMode === 'existing' ? styles.segActive : styles.seg} onClick={() => setBrokerMode('existing')}>
                    Corretora existente
                  </button>
                  <button className={brokerMode === 'new' ? styles.segActive : styles.seg} onClick={() => setBrokerMode('new')}>
                    + Nova corretora
                  </button>
                </div>
                {brokerMode === 'existing' ? (
                  <Select label="Corretora" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
                    {brokers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input label="Nome da corretora nova" value={newBrokerName} onChange={(e) => setNewBrokerName(e.target.value)} />
                )}
              </>
            )}

            <div className={styles.segmented}>
              <button className={kind === 'aporte' ? styles.segActive : styles.seg} onClick={() => setKind('aporte')}>
                Aporte
              </button>
              <button className={kind === 'resgate' ? styles.segActive : styles.seg} onClick={() => setKind('resgate')}>
                Resgate
              </button>
            </div>

            <div className={styles.formRow}>
              <Input
                label={`Valor (${currency})`}
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
              <Input label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: 13º investido" />

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
