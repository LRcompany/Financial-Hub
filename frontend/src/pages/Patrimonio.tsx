import { useEffect, useState } from 'react'
import { LineChart, PieChart, Activity, Flag, TrendingUp, TrendingDown, Trash2, Layers, Plus, X } from 'lucide-react'
import { api, type WealthOverview, type PositionsByType } from '../lib/api'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { MonthDelta } from '../components/MonthDelta'
import { ClientPieChart } from '../components/ClientPieChart'
import { CardHeader } from '../components/CardHeader'
import { currency } from '../lib/format'
import cards from '../styles/cards.module.css'
import styles from './Patrimonio.module.css'

const SECURITY_TYPES = ['FII', 'Ação', 'Renda Fixa', 'Cripto', 'Moeda', 'Fundo', 'Outro']

export function Patrimonio() {
  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [error, setError] = useState(false)

  const [positions, setPositions] = useState<PositionsByType[]>([])

  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({
    brokerName: '',
    securityName: '',
    type: 'Renda Fixa',
    currency: 'BRL',
    investedAmount: '',
    marketValue: '',
  })
  const [savingPosition, setSavingPosition] = useState(false)

  const [targetInput, setTargetInput] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)

  const [yearForm, setYearForm] = useState({
    year: String(new Date().getFullYear()),
    savingsTarget: '',
    annualReturnAssumptionPct: '',
  })
  const [savingYear, setSavingYear] = useState(false)

  function load() {
    api
      .wealthOverview()
      .then((w) => {
        setWealth(w)
        setTargetInput(w.wealthGoal ? String(w.wealthGoal.targetAmount) : '')
      })
      .catch(() => setError(true))
    api.positions().then((p) => setPositions(p.byType)).catch(() => {})
  }

  useEffect(load, [])

  async function saveNewPosition(e: React.FormEvent) {
    e.preventDefault()
    const investedAmount = Number(addForm.investedAmount)
    const marketValue = Number(addForm.marketValue)
    if (!addForm.brokerName || !addForm.securityName || !investedAmount || !marketValue) return
    setSavingPosition(true)
    try {
      await api.addPosition({
        brokerName: addForm.brokerName,
        securityName: addForm.securityName,
        type: addForm.type,
        currency: addForm.currency,
        investedAmount,
        marketValue,
      })
      setAddForm({ brokerName: '', securityName: '', type: 'Renda Fixa', currency: 'BRL', investedAmount: '', marketValue: '' })
      setShowAddForm(false)
      load()
    } finally {
      setSavingPosition(false)
    }
  }

  async function saveTarget(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(targetInput)
    if (!value || value <= 0) return
    setSavingTarget(true)
    try {
      await api.setWealthGoalTarget(value)
      load()
    } finally {
      setSavingTarget(false)
    }
  }

  async function saveYear(e: React.FormEvent) {
    e.preventDefault()
    const year = Number(yearForm.year)
    const savingsTarget = Number(yearForm.savingsTarget)
    const annualReturnAssumptionPct = Number(yearForm.annualReturnAssumptionPct)
    if (!year || !savingsTarget || !annualReturnAssumptionPct) return
    setSavingYear(true)
    try {
      await api.setWealthGoalYearly(year, savingsTarget, annualReturnAssumptionPct)
      setYearForm({ year: String(year + 1), savingsTarget: '', annualReturnAssumptionPct: '' })
      load()
    } finally {
      setSavingYear(false)
    }
  }

  async function removeYear(year: number) {
    await api.deleteWealthGoalYearly(year)
    load()
  }

  if (error) {
    return <div className={cards.emptyState}>Não consegui falar com o backend ainda.</div>
  }
  if (!wealth) {
    return null
  }

  const total = wealth.total ?? 0
  const goalProgress = wealth.wealthGoal ? Math.min((total / wealth.wealthGoal.targetAmount) * 100, 100) : 0

  return (
    <div className={cards.page}>
      <h1 className={styles.pageTitle}>Patrimônio</h1>

      <div className={cards.grid}>
        {!wealth.hasData && (
          <div className={`${cards.card} ${cards.fullWidth}`}>
            <div className={cards.emptyState}>
              Nenhum snapshot de investimento ainda — conecte um banco em "Mais" ou sincronize uma corretora existente.
            </div>
          </div>
        )}

        {wealth.hasData && (
          <>
            <div className={`${cards.card} ${cards.fullWidth}`}>
              <CardHeader icon={LineChart} title="Evolução do patrimônio" />
              <div className={cards.heroValue} style={{ fontSize: '1.6rem' }}>
                R$ {currency(total)}
              </div>
              <div className={cards.chartMeta}>
                <span>Patrimônio total</span>
                <MonthDelta current={total} previous={wealth.previousTotal ?? total} />
              </div>
              {wealth.evolution.length >= 2 ? (
                <SmoothLineChart
                  values={wealth.evolution.map((e) => e.value)}
                  labels={wealth.evolution.map((e) => e.label)}
                  gradientId="patrimonioEvolutionGradient"
                  className={cards.evolutionChart}
                />
              ) : (
                <div className={cards.emptyState}>Ainda sem histórico suficiente pra montar a evolução.</div>
              )}
            </div>

            <div className={cards.card}>
              <CardHeader icon={PieChart} title="Alocação de investimentos" />
              {wealth.allocation.length > 0 ? (
                <ClientPieChart data={wealth.allocation} />
              ) : (
                <div className={cards.emptyState}>Sem posições pra mostrar alocação ainda.</div>
              )}
            </div>

            <div className={cards.card}>
              <CardHeader icon={Activity} title="Destaques do mês" />
              {wealth.movers.length === 0 && <div className={cards.emptyState}>Sem histórico suficiente pra comparar.</div>}
              {wealth.movers.map((m, i) => (
                <div key={`${m.ticker}-${i}`} className={cards.moverRow}>
                  <span className={cards.moverTicker}>{m.ticker}</span>
                  <span className={cards.moverChange}>
                    {m.changePct >= 0 ? (
                      <TrendingUp size={14} className={cards.dirIn} />
                    ) : (
                      <TrendingDown size={14} className={cards.dirOut} />
                    )}
                    {m.changePct >= 0 ? '+' : ''}
                    {m.changePct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>

            {/* ---------- todas as posições, uma tabela por tipo de ativo ---------- */}
            <div className={`${cards.card} ${cards.fullWidth}`}>
              <CardHeader icon={Layers} title="Todas as posições" />
              {positions.length === 0 && <div className={cards.emptyState}>Nenhuma posição pra listar ainda.</div>}
              {positions.map((group) => (
                <div key={group.type} className={styles.positionGroup}>
                  <div className={styles.positionGroupHeader}>
                    <span>{group.type}</span>
                    <span>R$ {currency(group.total)}</span>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Ativo</th>
                          <th>Corretora</th>
                          <th>Investido</th>
                          <th>Valor atual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.positions.map((p, i) => (
                          <tr key={`${p.broker}-${p.name}-${i}`}>
                            <td>
                              {p.ticker ?? p.name}
                              {p.currency === 'USD' && <span className={styles.usdTag}>USD</span>}
                            </td>
                            <td>{p.broker}</td>
                            <td>R$ {currency(p.investedAmount)}</td>
                            <td>R$ {currency(p.marketValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------- Primeira Milhão ---------- */}
          <div className={`${cards.card} ${cards.fullWidth}`}>
            <CardHeader icon={Flag} title="Primeira Milhão" />

            <form className={styles.targetForm} onSubmit={saveTarget}>
              <label className={styles.formLabel}>
                Meta geral (R$)
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  placeholder="1000000"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                />
              </label>
              <button className={styles.saveBtn} type="submit" disabled={savingTarget}>
                Salvar meta
              </button>
            </form>

            {wealth.wealthGoal && (
              <>
                <div className={cards.dailyGoalTop} style={{ marginTop: 'var(--space-5)' }}>
                  <div>
                    <div className={cards.heroLabel}>Progresso até R$ {currency(wealth.wealthGoal.targetAmount)}</div>
                    <div className={cards.heroValue}>{goalProgress.toFixed(0)}%</div>
                  </div>
                  <div className={cards.dailyGoalMeta}>
                    <span className={cards.heroLabel}>Faltam</span>
                    <span style={{ fontWeight: 600 }}>
                      R$ {currency(Math.max(0, wealth.wealthGoal.targetAmount - total))}
                    </span>
                  </div>
                </div>
                <div className={cards.progressTrack} style={{ marginTop: 'var(--space-3)' }}>
                  <div className={cards.progressFill} style={{ width: `${goalProgress}%`, background: 'var(--accent)' }} />
                </div>
                <div className={cards.chartMeta}>
                  {wealth.wealthGoalYearly.length === 0 && (
                    <span>adicione pelo menos uma meta anual abaixo pra ver a projeção de data</span>
                  )}
                  {wealth.wealthGoalYearly.length > 0 && wealth.projection === null && (
                    <span>no ritmo das metas anuais configuradas, a meta não é alcançada nos próximos 50 anos</span>
                  )}
                  {wealth.projection && wealth.projection.monthsToGoal === 0 && <span>Meta já alcançada 🎉</span>}
                  {wealth.projection && wealth.projection.monthsToGoal > 0 && (
                    <span>
                      você chega lá em{' '}
                      {new Date(wealth.projection.projectedDate).toLocaleDateString('pt-BR', {
                        month: 'long',
                        year: 'numeric',
                      })}{' '}
                      (~{Math.floor(wealth.projection.monthsToGoal / 12)} anos e {wealth.projection.monthsToGoal % 12} meses)
                      {wealth.projection.usedExtrapolation && ' — usando a meta do último ano configurado pra frente'}
                    </span>
                  )}
                </div>
              </>
            )}

            <h3 className={styles.subheading}>Meta por ano</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ano</th>
                    <th>Aporte no ano</th>
                    <th>Retorno assumido</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {wealth.wealthGoalYearly.map((row) => (
                    <tr key={row.year}>
                      <td>{row.year}</td>
                      <td>R$ {currency(row.savingsTarget)}</td>
                      <td>{row.annualReturnAssumptionPct}% a.a.</td>
                      <td>
                        <button className={styles.iconBtn} onClick={() => removeYear(row.year)} aria-label={`Remover meta de ${row.year}`}>
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form className={styles.yearForm} onSubmit={saveYear}>
              <input
                className={styles.input}
                type="number"
                placeholder="Ano"
                value={yearForm.year}
                onChange={(e) => setYearForm({ ...yearForm, year: e.target.value })}
              />
              <input
                className={styles.input}
                type="number"
                step="0.01"
                placeholder="Aporte no ano (R$)"
                value={yearForm.savingsTarget}
                onChange={(e) => setYearForm({ ...yearForm, savingsTarget: e.target.value })}
              />
              <input
                className={styles.input}
                type="number"
                step="0.1"
                placeholder="Retorno assumido (% a.a.)"
                value={yearForm.annualReturnAssumptionPct}
                onChange={(e) => setYearForm({ ...yearForm, annualReturnAssumptionPct: e.target.value })}
              />
              <button className={styles.saveBtn} type="submit" disabled={savingYear}>
                Adicionar/atualizar ano
              </button>
            </form>

            {wealth.yearlyBreakdown.length > 0 && (
              <>
                <h3 className={styles.subheading}>Projeção ano a ano</h3>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Ano</th>
                        <th>Saldo inicial</th>
                        <th>Aporte no ano</th>
                        <th>Saldo final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wealth.yearlyBreakdown.map((row) => (
                        <tr key={row.year}>
                          <td>
                            {row.year}
                            {row.extrapolated && <span className={styles.extrapolatedTag}>estimado</span>}
                          </td>
                          <td>R$ {currency(row.startBalance)}</td>
                          <td>R$ {currency(row.contribution)}</td>
                          <td>R$ {currency(row.endBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
      </div>

      <button className={cards.fab} aria-label="Adicionar posição" onClick={() => setShowAddForm(true)}>
        <Plus size={22} strokeWidth={2} />
      </button>

      {showAddForm && (
        <div className={styles.overlay} onClick={() => setShowAddForm(false)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <h3 className={styles.subheading} style={{ margin: 0 }}>
                Adicionar posição manual
              </h3>
              <button className={styles.iconBtn} onClick={() => setShowAddForm(false)} aria-label="Fechar">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <p className={cards.heroLabel}>
              Só pra corretoras sem sync automático (Nomad, Wise, Phantom...) — se o banco já está conectado, o aporte
              entra sozinho no próximo sync.
            </p>
            <form className={styles.addForm} onSubmit={saveNewPosition}>
              <input
                className={styles.input}
                placeholder="Corretora (ex: Nomad)"
                value={addForm.brokerName}
                onChange={(e) => setAddForm({ ...addForm, brokerName: e.target.value })}
              />
              <input
                className={styles.input}
                placeholder="Nome do ativo"
                value={addForm.securityName}
                onChange={(e) => setAddForm({ ...addForm, securityName: e.target.value })}
              />
              <select className={styles.input} value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}>
                {SECURITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                className={styles.input}
                value={addForm.currency}
                onChange={(e) => setAddForm({ ...addForm, currency: e.target.value })}
              >
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
              </select>
              <input
                className={styles.input}
                type="number"
                step="0.01"
                placeholder={`Valor investido (${addForm.currency})`}
                value={addForm.investedAmount}
                onChange={(e) => setAddForm({ ...addForm, investedAmount: e.target.value })}
              />
              <input
                className={styles.input}
                type="number"
                step="0.01"
                placeholder={`Valor atual (${addForm.currency})`}
                value={addForm.marketValue}
                onChange={(e) => setAddForm({ ...addForm, marketValue: e.target.value })}
              />
              <button className={styles.saveBtn} type="submit" disabled={savingPosition}>
                Adicionar
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
