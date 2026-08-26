import { useEffect, useState } from 'react'
import {
  LineChart,
  PieChart,
  Activity,
  Flag,
  TrendingUp,
  TrendingDown,
  Trash2,
  Layers,
  Plus,
  X,
  Landmark,
  Building2,
  Bitcoin,
  DollarSign,
  FileUp,
} from 'lucide-react'
import { api, type WealthOverview, type PositionsByType, type Position, type Broker } from '../lib/api'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { MonthDelta } from '../components/MonthDelta'
import { ClientPieChart } from '../components/ClientPieChart'
import { VerticalBarChart } from '../components/VerticalBarChart'
import { CardHeader } from '../components/CardHeader'
import { HoverCard, HoverRow } from '../components/HoverCard'
import { StatementUploadModal } from '../components/StatementUploadModal'
import { ReturnBadge } from '../components/ReturnBadge'
import { Input } from '../components/Input'
import { Select } from '../components/Select'
import { currency } from '../lib/format'
import cards from '../styles/cards.module.css'
import styles from './Patrimonio.module.css'

const SECURITY_TYPES = ['FII', 'Ação', 'Renda Fixa', 'Cripto', 'Moeda', 'Fundo', 'Outro']

const TYPE_ICONS: Record<string, typeof PieChart> = {
  'Renda Fixa': Landmark,
  Ação: TrendingUp,
  FII: Building2,
  Fundo: Layers,
  Cripto: Bitcoin,
  Moeda: DollarSign,
}

// "Por corretora" (pizza) não faz sentido pra Cripto — PHANTOM_BTC, PHANTOM_
// ETH, PHANTOM_BASE não são corretoras diferentes de verdade, é a mesma
// carteira dividida por rede (implementação nossa, não escolha do Luiz).
const HIDE_BROKER_BREAKDOWN_TYPES = new Set(['Cripto'])

/** Agrupa e soma marketValue por uma chave (corretora, ativo...), maior
 * primeiro. `breakdown` traz o detalhe por sub-chave (o inverso da
 * agrupada — ex: agrupando por ativo, o breakdown é por corretora) pra
 * alimentar o hover quando o bucket junta mais de uma posição. */
function groupByKey(positions: Position[], keyFn: (p: Position) => string, subKeyFn: (p: Position) => string) {
  const map = new Map<string, Position[]>()
  for (const p of positions) {
    const key = keyFn(p)
    const list = map.get(key) ?? []
    list.push(p)
    map.set(key, list)
  }
  return [...map.entries()]
    .map(([label, items]) => {
      const subMap = new Map<string, number>()
      for (const p of items) subMap.set(subKeyFn(p), (subMap.get(subKeyFn(p)) ?? 0) + p.marketValue)
      return {
        label,
        value: items.reduce((sum, p) => sum + p.marketValue, 0),
        breakdown: [...subMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      }
    })
    .sort((a, b) => b.value - a.value)
}

/** "CDB - BANCO SOFISA S.A." -> "CDB" — a Pluggy detalha o emissor no nome,
 * mas pra ver "quanto tenho em CDB vs Tesouro vs Debênture" isso é ruído. */
function assetLabel(name: string) {
  const idx = name.indexOf(' - ')
  return idx === -1 ? name : name.slice(0, idx).trim()
}

// Ticker só é um nome de verdade pra ação/FII (PETR4, HGLG11). Pra renda fixa
// e fundo, o "código" que a Pluggy manda é um ISIN/identificador interno
// (ex: BRSTNCLF1RL5) — o nome ("CDB - BANCO C6 S.A.") é o que faz sentido ler.
const TICKER_TYPES = new Set(['Ação', 'FII'])
function displayName(p: Position, groupType: string) {
  return TICKER_TYPES.has(groupType) && p.ticker ? p.ticker : p.name
}

/** Total em USD de uma box, quando faz sentido mostrar. Nomad (100% em
 * posição USD) usa a taxa gravada de cada posição — mais precisa que uma
 * taxa única pro grupo. Cripto não grava taxa por posição (o preço já sai
 * em BRL direto do CoinGecko), então usa a cotação atual só pra exibição —
 * nunca reescreve o valor guardado, é só uma segunda leitura do mesmo total. */
function groupUsdTotal(group: PositionsByType, liveUsdToBrl: number | null): number | null {
  const usdPositions = group.positions.filter((p) => p.currency === 'USD' && p.fxRateToBRL)
  if (usdPositions.length > 0 && usdPositions.length === group.positions.length) {
    return usdPositions.reduce((sum, p) => sum + p.marketValue / p.fxRateToBRL!, 0)
  }
  if (group.type === 'Cripto' && liveUsdToBrl) {
    return group.total / liveUsdToBrl
  }
  return null
}

// "Moeda" não é um tipo de investimento de verdade pro Luiz — é só como o
// ativo é classificado (moeda estrangeira parada). Nesse caso específico o
// nome da corretora conta mais que o tipo. Ação/FII/Fundo continuam pelo
// tipo mesmo com corretora única — "BTG" duas vezes (Ação e FII) seria
// ambíguo, o tipo é a informação que importa ali.
const BROKER_AS_LABEL_TYPES = new Set(['Moeda'])

/** Conteúdo do hover de detalhe do ativo — cada campo só aparece se a Pluggy
 * (ou o registro manual) realmente tem aquele dado (nunca mostra "—" pra
 * tudo que falta). Usa o `HoverCard` genérico do projeto — mesmo padrão em
 * qualquer lista com detalhe extra pra mostrar no hover do nome do item. */
function assetHoverContent(p: Position) {
  const rows: { label: string; value: string }[] = []
  if (p.issuer) rows.push({ label: 'Emissor/Gestora', value: p.issuer })
  if (p.fixedAnnualRate != null) {
    // Taxa fixa numérica (CDB via Pluggy) — periodicidade é só um detalhe a mais.
    rows.push({ label: 'Taxa contratada', value: `${p.fixedAnnualRate}% a.a.${p.ratePeriodicity ? ` · ${p.ratePeriodicity}` : ''}` })
  } else if (p.ratePeriodicity) {
    // Taxa flutuante (CDI+6% a.a., IPCA+10,84% a.a. — empréstimo P2P tipo
    // INCO) — sem número fixo pra separar, guarda a descrição inteira aqui.
    rows.push({ label: 'Taxa contratada', value: p.ratePeriodicity })
  }
  if (p.dueDate) rows.push({ label: 'Vencimento', value: new Date(p.dueDate).toLocaleDateString('pt-BR') })
  if (p.isin) rows.push({ label: 'ISIN', value: p.isin })
  if (p.quantity != null && p.unitValue != null) {
    rows.push({ label: 'Posição', value: `${p.quantity % 1 === 0 ? p.quantity : p.quantity.toFixed(2)} cotas/ações a R$ ${currency(p.unitValue)}` })
  }
  if (p.currency === 'USD' && p.fxRateToBRL) {
    rows.push({ label: 'Valor em USD', value: `US$ ${currency(p.marketValue / p.fxRateToBRL)} (câmbio R$ ${p.fxRateToBRL.toFixed(2)})` })
  }
  if (rows.length === 0) return null
  return rows.map((r) => <HoverRow key={r.label} label={r.label} value={r.value} />)
}

export function Patrimonio() {
  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [error, setError] = useState(false)

  const [positions, setPositions] = useState<PositionsByType[]>([])
  const [groupHistories, setGroupHistories] = useState<Record<string, { label: string; value: number }[]>>({})
  const [usdToBrl, setUsdToBrl] = useState<number | null>(null)
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [uploadTarget, setUploadTarget] = useState<{ id: string; name: string } | null>(null)

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
    api
      .positions()
      .then((p) => {
        setPositions(p.byType)
        // Evolução por GRUPO (mesmo agrupamento da tela: tipo, ou corretora
        // quando standalone) — nunca por corretora sozinha, isso misturava
        // tipos (ex: BTG entra em Renda Fixa/FII/Ação/Fundo, a evolução de
        // "Ação" mostrava o BTG inteiro, não só as ações).
        p.byType.forEach((g) => {
          api
            .positionsHistory(g.type)
            .then((h) => setGroupHistories((prev) => ({ ...prev, [g.type]: h.history })))
            .catch(() => {})
        })
      })
      .catch(() => {})
    api
      .fxRate()
      .then((r) => setUsdToBrl(r.usdToBrl))
      .catch(() => {})
    api
      .brokers()
      .then(setBrokers)
      .catch(() => {})
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

  // Mesma regra das boxes abaixo: corretora única vira o nome dela em vez do
  // tipo genérico ("Moeda" não é onde eu invisto, é só classificação do ativo).
  const allocationData = positions.map((group) => {
    const brokers = new Set(group.positions.map((p) => p.broker))
    const label = BROKER_AS_LABEL_TYPES.has(group.type) && brokers.size === 1 ? [...brokers][0] : group.type
    return { label, value: group.total }
  })

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
              {allocationData.length > 0 ? (
                <ClientPieChart data={allocationData} />
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

            {/* ---------- uma box por tipo de ativo, com gráficos específicos ---------- */}
            {positions.length === 0 && (
              <div className={`${cards.card} ${cards.fullWidth}`}>
                <div className={cards.emptyState}>Nenhuma posição pra listar ainda.</div>
              </div>
            )}
            {positions.map((group) => {
              const brokerBreakdown = groupByKey(
                group.positions,
                (p) => p.broker,
                (p) => assetLabel(displayName(p, group.type))
              )
              const assetBreakdown = groupByKey(
                group.positions,
                (p) => assetLabel(displayName(p, group.type)),
                (p) => p.broker
              )
              const Icon = group.isBroker ? Landmark : (TYPE_ICONS[group.type] ?? PieChart)
              const singleBroker = brokerBreakdown.length === 1 ? brokerBreakdown[0].label : null
              // Evolução é por grupo inteiro (todas as corretoras daquele
              // tipo somadas) — nunca precisou de corretora única pra fazer
              // sentido, e limitar a isso escondia a evolução de Renda Fixa/
              // Cripto (várias corretoras cada).
              const history = groupHistories[group.type]

              const title = BROKER_AS_LABEL_TYPES.has(group.type) && singleBroker ? singleBroker : group.type
              const usdTotal = groupUsdTotal(group, usdToBrl)
              // Upload de extrato é específico do formato Nomad/Apex Clearing
              // (parseNomadStatement) — não é genérico pra qualquer corretora
              // manual_statement (INCO também é standalone+manual, mas não
              // tem PDF nesse formato; usaria o parser errado).
              const broker = group.isBroker ? brokers.find((b) => b.name === group.type) : undefined
              const supportsStatementUpload = broker?.name === 'NOMAD'

              return (
                <div key={group.type} className={`${cards.card} ${cards.fullWidth}`}>
                  <CardHeader
                    icon={Icon}
                    title={title}
                    action={
                      supportsStatementUpload && broker ? (
                        <button className={styles.uploadBtn} onClick={() => setUploadTarget({ id: broker.id, name: broker.name })}>
                          <FileUp size={13} strokeWidth={2} />
                          Atualizar por extrato
                        </button>
                      ) : undefined
                    }
                  />
                  <div className={cards.heroValue} style={{ fontSize: '1.4rem' }}>
                    R$ {currency(group.total)}
                  </div>
                  {usdTotal != null && <div className={styles.usdSecondary}>US$ {currency(usdTotal)}</div>}
                  <div className={cards.chartMeta}>
                    <span>
                      {group.positions.length} posiç{group.positions.length === 1 ? 'ão' : 'ões'}
                    </span>
                  </div>

                  {/* Evolução primeiro — é a visão geral (como isso mudou no
                      tempo); a composição atual (por corretora/ativo) vem
                      depois, como detalhe. Espaçamento entre blocos sempre
                      --space-5 (24px), nunca condicional a 0 — cada bloco
                      (valor total, evolução, composição, tabela) respira
                      igual, tenha ou não o bloco anterior renderizado. */}
                  {history && history.length >= 2 && (
                    <div style={{ marginTop: 'var(--space-5)' }}>
                      <h4 className={styles.chartLabel}>Evolução</h4>
                      <SmoothLineChart
                        values={history.map((h) => h.value)}
                        labels={history.map((h) => h.label)}
                        gradientId={`history-${group.type.replace(/\s+/g, '-')}`}
                        className={cards.evolutionChart}
                      />
                    </div>
                  )}

                  {/* Por corretora: pizza, só quando tem mais de uma de
                      verdade E isso é informação real pro Luiz — Cripto fica
                      de fora porque "PHANTOM_BTC"/"PHANTOM_BASE" não são
                      corretoras distintas, é a mesma carteira dividida por
                      rede (detalhe técnico nosso, não escolha dele). */}
                  {brokerBreakdown.length > 1 && !HIDE_BROKER_BREAKDOWN_TYPES.has(group.type) && (
                    <div style={{ marginTop: 'var(--space-5)' }}>
                      <h4 className={styles.chartLabel}>Por corretora</h4>
                      <ClientPieChart data={brokerBreakdown} />
                    </div>
                  )}

                  {/* Por ativo: sempre barra vertical 100% da largura — lê
                      melhor que pizza quando tem muito ativo, e cabe mais
                      opção por ser full-width. max alto o bastante pra
                      mostrar todo mundo (a barra estreita sozinha via flex),
                      sem truncar em "Outros" à toa. */}
                  {assetBreakdown.length > 1 && (
                    <div style={{ marginTop: 'var(--space-5)' }}>
                      <h4 className={styles.chartLabel}>Por ativo</h4>
                      <VerticalBarChart data={assetBreakdown} />
                    </div>
                  )}

                  <div className={styles.tableWrap} style={{ marginTop: 'var(--space-5)' }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Ativo</th>
                          <th>Corretora</th>
                          <th>Cotas/qtd.</th>
                          <th>Preço unit.</th>
                          <th>Investido</th>
                          <th>Valor atual</th>
                          <th>Rentab.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.positions.map((p, i) => (
                          <tr key={`${p.broker}-${p.name}-${i}`}>
                            <td>
                              <HoverCard content={assetHoverContent(p)}>
                                <span className={styles.assetName}>
                                  {displayName(p, group.type)}
                                  {p.currency === 'USD' && <span className={styles.usdTag}>USD</span>}
                                </span>
                              </HoverCard>
                            </td>
                            <td>{p.broker}</td>
                            <td>{p.quantity != null ? (p.quantity % 1 === 0 ? p.quantity : p.quantity.toFixed(2)) : '—'}</td>
                            <td>{p.unitValue != null ? `R$ ${currency(p.unitValue)}` : '—'}</td>
                            <td>
                              R$ {currency(p.investedAmount)}
                              {p.currency === 'USD' && p.fxRateToBRL && (
                                <div className={styles.usdSecondary}>US$ {currency(p.investedAmount / p.fxRateToBRL)}</div>
                              )}
                              {p.currency === 'BRL' && group.type === 'Cripto' && usdToBrl && (
                                <div className={styles.usdSecondary}>US$ {currency(p.investedAmount / usdToBrl)}</div>
                              )}
                            </td>
                            <td>
                              R$ {currency(p.marketValue)}
                              {p.currency === 'USD' && p.fxRateToBRL && (
                                <div className={styles.usdSecondary}>US$ {currency(p.marketValue / p.fxRateToBRL)}</div>
                              )}
                              {p.currency === 'BRL' && group.type === 'Cripto' && usdToBrl && (
                                <div className={styles.usdSecondary}>US$ {currency(p.marketValue / usdToBrl)}</div>
                              )}
                            </td>
                            <td>
                              <ReturnBadge invested={p.investedAmount} current={p.marketValue} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* ---------- Primeira Milhão ---------- */}
          <div className={`${cards.card} ${cards.fullWidth}`}>
            <CardHeader icon={Flag} title="Primeira Milhão" />

            <form className={styles.targetForm} onSubmit={saveTarget}>
              <Input
                label="Meta geral (R$)"
                type="number"
                step="0.01"
                placeholder="1000000"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
              />
              <button className={cards.saveBtn} type="submit" disabled={savingTarget}>
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
              <Input
                type="number"
                placeholder="Ano"
                value={yearForm.year}
                onChange={(e) => setYearForm({ ...yearForm, year: e.target.value })}
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Aporte no ano (R$)"
                value={yearForm.savingsTarget}
                onChange={(e) => setYearForm({ ...yearForm, savingsTarget: e.target.value })}
              />
              <Input
                type="number"
                step="0.1"
                placeholder="Retorno assumido (% a.a.)"
                value={yearForm.annualReturnAssumptionPct}
                onChange={(e) => setYearForm({ ...yearForm, annualReturnAssumptionPct: e.target.value })}
              />
              <button className={cards.saveBtn} type="submit" disabled={savingYear}>
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

      {uploadTarget && (
        <StatementUploadModal
          brokerId={uploadTarget.id}
          brokerName={uploadTarget.name}
          onClose={() => setUploadTarget(null)}
          onSaved={() => {
            setUploadTarget(null)
            load()
          }}
        />
      )}

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
              <Input
                placeholder="Corretora (ex: Nomad)"
                value={addForm.brokerName}
                onChange={(e) => setAddForm({ ...addForm, brokerName: e.target.value })}
              />
              <Input
                placeholder="Nome do ativo"
                value={addForm.securityName}
                onChange={(e) => setAddForm({ ...addForm, securityName: e.target.value })}
              />
              <Select value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}>
                {SECURITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Select value={addForm.currency} onChange={(e) => setAddForm({ ...addForm, currency: e.target.value })}>
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
              </Select>
              <Input
                type="number"
                step="0.01"
                placeholder={`Valor investido (${addForm.currency})`}
                value={addForm.investedAmount}
                onChange={(e) => setAddForm({ ...addForm, investedAmount: e.target.value })}
              />
              <Input
                type="number"
                step="0.01"
                placeholder={`Valor atual (${addForm.currency})`}
                value={addForm.marketValue}
                onChange={(e) => setAddForm({ ...addForm, marketValue: e.target.value })}
              />
              <button className={cards.saveBtn} type="submit" disabled={savingPosition}>
                Adicionar
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
