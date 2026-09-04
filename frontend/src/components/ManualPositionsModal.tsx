import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { api, type BrokerPosition, type PositionFieldConfig } from '../lib/api'
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
  investedAmount: string
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
    investedAmount: String(p.investedAmount),
    lastUpdated: p.lastUpdated,
  }
}

function emptyRow(config: PositionFieldConfig): Row {
  return {
    name: '',
    type: config.fixedType ?? 'Renda Fixa',
    currency: config.currency === 'selectable' ? 'BRL' : config.currency,
    quantity: '',
    unitValue: '',
    marketValue: '',
    investedAmount: '',
  }
}

/** Popup de atualização manual mês a mês (Nomad, INCO, Wise — corretora sem
 * sync automático e sem extrato num formato que dá pra ler). Luiz abre o app
 * dele, olha o valor de cada investimento e digita aqui — nada é adivinhado.
 * Salvar grava um PositionSnapshot novo pro mês/ano de hoje por posição, sem
 * sobrescrever o histórico anterior (é assim que a evolução mês a mês
 * continua existindo). Colunas variam por corretora (`fieldConfig`, vindo do
 * backend) — Nomad acompanha investido/atual, Wise só o saldo, INCO nem tem
 * quantidade nem moeda pra escolher. */
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
  const [fieldConfig, setFieldConfig] = useState<PositionFieldConfig | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .brokerPositions(brokerId)
      .then((r) => {
        setRows(r.positions.map(toRow))
        setLastSyncedAt(r.brokerLastSyncedAt)
        setFieldConfig(r.fieldConfig)
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
    if (!fieldConfig) return
    setRows((prev) => [...prev, emptyRow(fieldConfig)])
  }

  async function handleSave() {
    if (!fieldConfig) return
    setError(null)
    const payload = rows
      .filter((r) => r.name.trim() && r.marketValue !== '')
      .map((r) => ({
        securityId: r.securityId,
        name: r.name.trim(),
        type: fieldConfig.fixedType ?? r.type,
        currency: fieldConfig.currency === 'selectable' ? r.currency : fieldConfig.currency,
        quantity: fieldConfig.showQuantity && r.quantity !== '' ? Number(r.quantity) : null,
        unitValue: fieldConfig.showUnitValue && r.unitValue !== '' ? Number(r.unitValue) : null,
        marketValue: Number(r.marketValue),
        investedAmount: fieldConfig.showInvestedAmount && r.investedAmount !== '' ? Number(r.investedAmount) : null,
      }))
    if (payload.length === 0) {
      setError('Preencha ao menos um ativo com valor atual.')
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

        {loading || !fieldConfig ? (
          <p className={styles.helperText}>Carregando...</p>
        ) : (
          <>
            <p className={styles.helperText}>
              Abra o app da {brokerName} e digite o valor atual de cada investimento. Cada salvamento vira um registro do
              mês — o histórico anterior não é sobrescrito. Encerrou algum? Deixe o valor atual em 0 em vez de remover a
              linha (remover só tira do salvamento de agora, não marca como zerado).
            </p>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ativo</th>
                    {fieldConfig.showType && <th>Tipo</th>}
                    {fieldConfig.currency === 'selectable' && <th>Moeda</th>}
                    {fieldConfig.showQuantity && <th>Qtd.</th>}
                    {fieldConfig.showUnitValue && <th>Valor unit.</th>}
                    {fieldConfig.showInvestedAmount && <th>Valor investido</th>}
                    <th>Valor atual</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.securityId ?? `new-${i}`}>
                      <td className={styles.nameCell}>
                        <Input placeholder="Nome do ativo" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
                        {r.lastUpdated && <div className={styles.lastUpdated}>atualizado {r.lastUpdated}</div>}
                      </td>
                      {fieldConfig.showType && (
                        <td>
                          <Select value={r.type} onChange={(e) => updateRow(i, { type: e.target.value })}>
                            {SECURITY_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </Select>
                        </td>
                      )}
                      {fieldConfig.currency === 'selectable' && (
                        <td>
                          <Select value={r.currency} onChange={(e) => updateRow(i, { currency: e.target.value })}>
                            <option value="BRL">BRL</option>
                            <option value="USD">USD</option>
                          </Select>
                        </td>
                      )}
                      {fieldConfig.showQuantity && (
                        <td>
                          <Input type="number" step="0.000001" value={r.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} />
                        </td>
                      )}
                      {fieldConfig.showUnitValue && (
                        <td>
                          <Input type="number" step="0.01" value={r.unitValue} onChange={(e) => updateRow(i, { unitValue: e.target.value })} />
                        </td>
                      )}
                      {fieldConfig.showInvestedAmount && (
                        <td>
                          <Input
                            type="number"
                            step="0.01"
                            value={r.investedAmount}
                            onChange={(e) => updateRow(i, { investedAmount: e.target.value })}
                          />
                        </td>
                      )}
                      <td>
                        <Input type="number" step="0.01" value={r.marketValue} onChange={(e) => updateRow(i, { marketValue: e.target.value })} />
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
