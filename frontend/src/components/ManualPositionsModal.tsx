import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { api, type BrokerPosition } from '../lib/api'
import { Input } from './Input'
import { Select } from './Select'
import styles from './ManualPositionsModal.module.css'

const SECURITY_TYPES = ['Renda Fixa', 'Fundo', 'Ação', 'FII', 'Cripto', 'Moeda', 'Outro']

interface Row {
  securityId?: string
  name: string
  type: string
  currency: string
  quantity: string
  unitValue: string
  marketValue: string
  lastUpdated?: string
}

function toRow(p: BrokerPosition): Row {
  return {
    securityId: p.securityId,
    name: p.name,
    type: p.type,
    currency: p.currency,
    quantity: p.quantity != null ? String(p.quantity) : '',
    unitValue: p.unitValue != null ? String(p.unitValue) : '',
    marketValue: String(p.marketValue),
    lastUpdated: p.lastUpdated,
  }
}

const EMPTY_ROW: Row = { name: '', type: 'Renda Fixa', currency: 'BRL', quantity: '', unitValue: '', marketValue: '' }

/** Popup de atualização manual mês a mês (Nomad, INCO, Wise — corretora sem
 * sync automático e sem extrato num formato que dá pra ler). Luiz abre o app
 * dele, olha o valor de cada investimento e digita aqui — nada é adivinhado.
 * Salvar grava um PositionSnapshot novo pro mês/ano de hoje por posição, sem
 * sobrescrever o histórico anterior (é assim que a evolução mês a mês
 * continua existindo). */
export function ManualPositionsModal({
  brokerId,
  brokerName,
  onClose,
  onSaved,
}: {
  brokerId: string
  brokerName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .brokerPositions(brokerId)
      .then((r) => {
        setRows(r.positions.map(toRow))
        setLastSyncedAt(r.brokerLastSyncedAt)
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [brokerId])

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  async function handleSave() {
    setError(null)
    const payload = rows
      .filter((r) => r.name.trim() && r.marketValue !== '')
      .map((r) => ({
        securityId: r.securityId,
        name: r.name.trim(),
        type: r.type,
        currency: r.currency,
        quantity: r.quantity !== '' ? Number(r.quantity) : null,
        unitValue: r.unitValue !== '' ? Number(r.unitValue) : null,
        marketValue: Number(r.marketValue),
      }))
    if (payload.length === 0) {
      setError('Preencha ao menos um ativo com valor de mercado.')
      return
    }
    setSaving(true)
    try {
      await api.updateBrokerPositions(brokerId, payload)
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
            <h3 className={styles.title}>Atualizar posições — {brokerName}</h3>
            <p className={styles.subtitle}>
              {lastSyncedAt
                ? `última atualização: ${new Date(lastSyncedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`
                : 'nunca atualizado manualmente'}
            </p>
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {loading ? (
          <p className={styles.helperText}>Carregando...</p>
        ) : (
          <>
            <p className={styles.helperText}>
              Abra o app da {brokerName} e digite o valor atual de cada investimento. Cada salvamento vira um registro do
              mês — o histórico anterior não é sobrescrito. Encerrou algum? Deixe o valor de mercado em 0 em vez de
              remover a linha (remover só tira do salvamento de agora, não marca como zerado).
            </p>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ativo</th>
                    <th>Tipo</th>
                    <th>Moeda</th>
                    <th>Qtd.</th>
                    <th>Valor unit.</th>
                    <th>Valor de mercado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.securityId ?? `new-${i}`}>
                      <td>
                        <Input placeholder="Nome do ativo" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
                        {r.lastUpdated && <div className={styles.lastUpdated}>atualizado {r.lastUpdated}</div>}
                      </td>
                      <td>
                        <Select value={r.type} onChange={(e) => updateRow(i, { type: e.target.value })}>
                          {SECURITY_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <Select value={r.currency} onChange={(e) => updateRow(i, { currency: e.target.value })}>
                          <option value="BRL">BRL</option>
                          <option value="USD">USD</option>
                        </Select>
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="0.000001"
                          value={r.quantity}
                          onChange={(e) => updateRow(i, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="0.01"
                          value={r.unitValue}
                          onChange={(e) => updateRow(i, { unitValue: e.target.value })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="0.01"
                          value={r.marketValue}
                          onChange={(e) => updateRow(i, { marketValue: e.target.value })}
                        />
                      </td>
                      <td>
                        <button className={styles.iconBtn} onClick={() => removeRow(i)} aria-label="Remover linha">
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button className={styles.addRowBtn} onClick={addRow}>
              <Plus size={13} strokeWidth={2} />
              Novo ativo
            </button>

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
