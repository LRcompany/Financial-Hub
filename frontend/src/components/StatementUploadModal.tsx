import { useState } from 'react'
import { X, Upload, AlertTriangle } from 'lucide-react'
import { api, type ParsedStatement, type ParsedStatementPosition } from '../lib/api'
import { currency } from '../lib/format'
import { Input } from './Input'
import { Select } from './Select'
import styles from './StatementUploadModal.module.css'

const SECURITY_TYPES = ['Renda Fixa', 'Fundo', 'Ação', 'FII', 'Cripto', 'Moeda', 'Outro']

/** Upload de extrato PDF (hoje só o formato Nomad/Apex Clearing) — extrai e
 * mostra uma prévia editável, nunca grava direto. Confirmação é um passo
 * separado e explícito: layout de extrato mudar não corrompe dado, na pior
 * das hipóteses a extração erra um campo e fica visível pra corrigir antes
 * de confirmar. */
export function StatementUploadModal({ brokerId, brokerName, onClose, onSaved }: { brokerId: string; brokerName: string; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<'upload' | 'review'>('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedStatement | null>(null)
  const [period, setPeriod] = useState<{ month: number; year: number } | null>(null)
  const [positions, setPositions] = useState<ParsedStatementPosition[]>([])
  const [fdicBalance, setFdicBalance] = useState<string>('')
  const [saving, setSaving] = useState(false)

  async function handleFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const result = await api.previewStatement(brokerId, file)
      setParsed(result.parsed)
      setPeriod({ month: result.month, year: result.year })
      setPositions(result.parsed.positions)
      setFdicBalance(result.parsed.fdicBalance != null ? String(result.parsed.fdicBalance) : '')
      setStep('review')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function updatePosition(i: number, patch: Partial<ParsedStatementPosition>) {
    setPositions((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  async function handleConfirm() {
    if (!period || !parsed?.periodEnd) return
    setSaving(true)
    setError(null)
    try {
      await api.confirmStatement(brokerId, {
        month: period.month,
        year: period.year,
        periodEnd: parsed.periodEnd,
        positions,
        fdicBalance: fdicBalance ? Number(fdicBalance) : null,
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
          <h3 className={styles.title}>Atualizar {brokerName} por extrato (PDF)</h3>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {step === 'upload' && (
          <div className={styles.uploadArea}>
            <Upload size={28} strokeWidth={1.5} className={styles.uploadIcon} />
            <p className={styles.uploadText}>Selecione o extrato mensal em PDF (formato Apex Clearing / Nomad).</p>
            <label className={styles.fileBtn}>
              {loading ? 'Lendo PDF...' : 'Escolher arquivo'}
              <input
                type="file"
                accept="application/pdf"
                hidden
                disabled={loading}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>
            {error && <p className={styles.error}>{error}</p>}
          </div>
        )}

        {step === 'review' && parsed && period && (
          <div className={styles.review}>
            <p className={styles.periodLabel}>
              Período: {String(period.month).padStart(2, '0')}/{period.year} — confira os valores antes de confirmar.
            </p>

            {parsed.warnings.length > 0 && (
              <div className={styles.warningBox}>
                <AlertTriangle size={14} strokeWidth={2} />
                <div>
                  {parsed.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ativo</th>
                    <th>Tipo</th>
                    <th>Qtd.</th>
                    <th>Preço (US$)</th>
                    <th>Valor (US$)</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={p.cusip}>
                      <td>
                        <div className={styles.assetName}>{p.name}</div>
                        <div className={styles.cusip}>{p.cusip}</div>
                      </td>
                      <td>
                        <Select value={p.type} onChange={(e) => updatePosition(i, { type: e.target.value })}>
                          {SECURITY_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <Input
                          type="number"
                          value={p.quantity}
                          onChange={(e) => updatePosition(i, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="0.0001"
                          value={p.unitValue}
                          onChange={(e) => updatePosition(i, { unitValue: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <Input
                          type="number"
                          step="0.01"
                          value={p.marketValue}
                          onChange={(e) => updatePosition(i, { marketValue: Number(e.target.value) })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Input
              label="Saldo FDIC Insured Deposit (US$) — deixe vazio se não tiver"
              type="number"
              step="0.01"
              value={fdicBalance}
              onChange={(e) => setFdicBalance(e.target.value)}
            />

            {parsed.totalNetWorth != null && (
              <p className={styles.checkLine}>
                Total no extrato: US$ {currency(parsed.totalNetWorth)} — confira se bate com a soma acima + FDIC.
              </p>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={() => setStep('upload')} disabled={saving}>
                Escolher outro arquivo
              </button>
              <button className={styles.saveBtn} onClick={handleConfirm} disabled={saving}>
                {saving ? 'Salvando...' : 'Confirmar e salvar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
