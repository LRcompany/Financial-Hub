import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  PieChart,
  TrendingDown,
  Activity,
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  Receipt,
  Users,
  LineChart,
  X,
  Pause,
  Play,
  Ban,
} from 'lucide-react'
import {
  api,
  type ProjectsSummary,
  type ProjectListItem,
  type ProjectDetail,
  type Client,
  type Supplier,
  type TaxPayment,
} from '../lib/api'
import { CardHeader } from '../components/CardHeader'
import { ClientPieChart } from '../components/ClientPieChart'
import { SmoothLineChart } from '../components/SmoothLineChart'
import { Input } from '../components/Input'
import { Select } from '../components/Select'
import { currency } from '../lib/format'
import cards from '../styles/cards.module.css'
import styles from './Projetos.module.css'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_LABEL: Record<string, string> = {
  em_andamento: 'Em andamento',
  finalizado: 'Finalizado',
  pausado: 'Pausado',
  cancelado: 'Cancelado',
}

const NEW_CLIENT = '__new__'
const NEW_SUPPLIER = '__new__'

export function Projetos() {
  const [summary, setSummary] = useState<ProjectsSummary | null>(null)
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [taxPayments, setTaxPayments] = useState<TaxPayment[]>([])
  const [error, setError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewTax, setShowNewTax] = useState(false)

  function load() {
    Promise.all([api.projectsSummary(), api.projects(), api.clients(), api.suppliers(), api.taxPayments()])
      .then(([s, p, c, sup, tax]) => {
        setSummary(s)
        setProjects(p)
        setClients(c)
        setSuppliers(sup)
        setTaxPayments(tax)
        setError(false)
      })
      .catch(() => setError(true))
  }

  useEffect(load, [])

  if (error) return <div className={cards.emptyState}>Não consegui falar com o backend ainda.</div>
  if (!summary) return null

  return (
    <div className={cards.page}>
      <h1 className={styles.pageTitle}>Projetos</h1>

      {/* ---------- Visão Geral ---------- */}
      <section>
        <h2 className={cards.sectionTitle}>Visão Geral</h2>
        <div className={cards.grid}>
          <div className={`${cards.card} ${cards.fullWidth}`}>
            <CardHeader icon={LineChart} title="Resumo" />
            <div className={cards.statGrid}>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Receita bruta</span>
                <span className={cards.statTileValue}>R$ {currency(summary.grossRevenue)}</span>
              </div>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Imposto previsto</span>
                <span className={cards.statTileValue}>R$ {currency(summary.taxEstimatedTotal)}</span>
                {summary.hasEstimatedTax && <span className={styles.pendingNote}>inclui estimativa de 6% até o DAS real chegar</span>}
              </div>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Imposto pago</span>
                <span className={cards.statTileValue}>R$ {currency(summary.taxPaidTotal)}</span>
              </div>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Receita líquida</span>
                <span className={cards.statTileValue}>R$ {currency(summary.netRevenue)}</span>
              </div>
            </div>
            <div className={cards.statGrid} style={{ marginTop: 'var(--space-3)' }}>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Média mensal (12m)</span>
                <span className={cards.statTileValue}>R$ {currency(summary.avgMonthly12m)}</span>
              </div>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Dias trabalhados</span>
                <span className={cards.statTileValue}>{summary.totalDaysWorked}</span>
              </div>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Projetos finalizados</span>
                <span className={cards.statTileValue}>{summary.finalizedCount}</span>
              </div>
              <div className={cards.statTile}>
                <span className={cards.heroLabel}>Projetos em aberto</span>
                <span className={cards.statTileValue}>{summary.openCount}</span>
              </div>
            </div>
            <div className={cards.chartMeta} style={{ marginTop: 'var(--space-3)' }}>
              <span>Recebido por mês</span>
            </div>
            <SmoothLineChart
              values={summary.monthlyReceived.map((m) => m.value)}
              labels={summary.monthlyReceived.map((m) => m.label)}
              gradientId="projetosMonthlyReceivedGradient"
              className={cards.evolutionChart}
            />
          </div>

          <div className={cards.card}>
            <CardHeader icon={TrendingDown} title="Total de saídas" />
            <div className={styles.statRow}>
              <span className={cards.heroLabel}>Imposto pago (ano)</span>
              <span className={cards.statValue}>R$ {currency(summary.taxPaidThisYear)}</span>
            </div>
            <div className={styles.statRow}>
              <span className={cards.heroLabel}>Fornecedores pago</span>
              <span className={cards.statValue}>R$ {currency(summary.supplierPaid)}</span>
            </div>
          </div>

          <div className={cards.card}>
            <CardHeader icon={Activity} title="Atual" />
            <div className={styles.statRow}>
              <span className={cards.heroLabel}>Total recebido</span>
              <span className={cards.statValue}>R$ {currency(summary.receivedThisYear)}</span>
            </div>
            <div className={styles.statRow}>
              <span className={cards.heroLabel}>Total a receber</span>
              <span className={cards.statValue}>R$ {currency(summary.outstanding)}</span>
            </div>
            <div className={styles.statRow}>
              <span className={cards.heroLabel}>Total pago (fornecedor)</span>
              <span className={cards.statValue}>R$ {currency(summary.supplierPaid)}</span>
            </div>
            <div className={styles.statRow}>
              <span className={cards.heroLabel}>Total a pagar (fornecedor)</span>
              <span className={cards.statValue}>R$ {currency(summary.supplierOutstanding)}</span>
            </div>
          </div>

          <div className={`${cards.card} ${cards.fullWidth}`}>
            <CardHeader icon={PieChart} title="Ganhos totais por cliente" />
            {summary.clientContractValue.length > 0 ? (
              <ClientPieChart data={summary.clientContractValue} />
            ) : (
              <div className={cards.emptyState}>Nenhum projeto cadastrado ainda.</div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Projetos ---------- */}
      <section>
        <div className={styles.sectionHeaderRow}>
          <h2 className={cards.sectionTitle}>Projetos</h2>
          <button className={styles.addBtn} onClick={() => setShowNewProject((v) => !v)}>
            <Plus size={14} strokeWidth={2} />
            Novo projeto
          </button>
        </div>

        {showNewProject && (
          <NewProjectForm
            clients={clients}
            onCancel={() => setShowNewProject(false)}
            onSaved={() => {
              setShowNewProject(false)
              load()
            }}
          />
        )}

        {projects.length === 0 && !showNewProject && (
          <div className={cards.emptyState}>Nenhum projeto cadastrado ainda — clique em "Novo projeto" pra começar.</div>
        )}

        <div className={styles.projectList}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              suppliers={suppliers}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              onChanged={load}
            />
          ))}
        </div>
      </section>

      {/* ---------- Impostos (DAS) ---------- */}
      <section>
        <div className={styles.sectionHeaderRow}>
          <h2 className={cards.sectionTitle}>Impostos (DAS)</h2>
          <button className={styles.addBtn} onClick={() => setShowNewTax((v) => !v)}>
            <Plus size={14} strokeWidth={2} />
            Registrar DAS
          </button>
        </div>
        <p className={styles.helperText}>
          Um DAS por mês de competência — o valor é rateado entre os projetos que faturaram naquele mês (só isso
          resolve o imposto de projeto de cliente estrangeiro, que é variável e só se sabe no boleto).
        </p>

        {showNewTax && <NewTaxPaymentForm onCancel={() => setShowNewTax(false)} onSaved={() => { setShowNewTax(false); load() }} />}

        {taxPayments.length === 0 && !showNewTax && <div className={cards.emptyState}>Nenhum DAS registrado ainda.</div>}

        {taxPayments.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Faturamento do mês</th>
                  <th>Valor pago (real)</th>
                  <th>Alíquota efetiva</th>
                  <th>Data pgto.</th>
                </tr>
              </thead>
              <tbody>
                {taxPayments.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {String(t.competenceMonth).padStart(2, '0')}/{t.competenceYear}
                    </td>
                    <td>R$ {currency(t.totalRevenue)}</td>
                    <td>R$ {currency(t.amountPaid)}</td>
                    <td>{t.totalRevenue > 0 ? ((t.amountPaid / t.totalRevenue) * 100).toFixed(2) : '0,00'}%</td>
                    <td>{formatDate(t.paymentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- Novo projeto ----------

function NewProjectForm({ clients, onCancel, onSaved }: { clients: Client[]; onCancel: () => void; onSaved: () => void }) {
  const [clientChoice, setClientChoice] = useState(clients[0]?.id ?? NEW_CLIENT)
  const [newClientName, setNewClientName] = useState('')
  const [newClientForeign, setNewClientForeign] = useState(false)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [contractValue, setContractValue] = useState('')
  const [hasInvoice, setHasInvoice] = useState(true)
  const [installmentCount, setInstallmentCount] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !startDate || !contractValue) return
    setSaving(true)
    setError(null)
    try {
      let clientId = clientChoice
      if (clientChoice === NEW_CLIENT) {
        if (!newClientName.trim()) {
          setError('Digite o nome do cliente novo.')
          setSaving(false)
          return
        }
        const client = await api.createClient({ name: newClientName.trim(), isForeign: newClientForeign })
        clientId = client.id
      }
      await api.createProject({
        clientId,
        name: name.trim(),
        startDate,
        endDate: endDate || null,
        contractValue: Number(contractValue),
        hasInvoice,
        installmentCount: Number(installmentCount) || 1,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`${cards.card} ${styles.form}`} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <Select label="Cliente" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_CLIENT}>+ Novo cliente</option>
        </Select>
        {clientChoice === NEW_CLIENT && (
          <>
            <Input label="Nome do cliente" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={newClientForeign} onChange={(e) => setNewClientForeign(e.target.checked)} />
              Cliente estrangeiro (DAS variável)
            </label>
          </>
        )}
      </div>
      <div className={styles.formRow}>
        <Input label="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Início" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <Input label="Fim (opcional)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className={styles.formRow}>
        <Input label="Valor do projeto (R$)" type="number" step="0.01" value={contractValue} onChange={(e) => setContractValue(e.target.value)} />
        <Input label="Nº de parcelas" type="number" value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} />
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={hasInvoice} onChange={(e) => setHasInvoice(e.target.checked)} />
          Com nota fiscal
        </label>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.formActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className={cards.saveBtn} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

// ---------- Card de projeto (linha + detalhe expansível) ----------

function ProjectCard({
  project,
  suppliers,
  expanded,
  onToggle,
  onChanged,
}: {
  project: ProjectListItem
  suppliers: Supplier[]
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  function loadDetail() {
    setLoadingDetail(true)
    api
      .project(project.id)
      .then(setDetail)
      .finally(() => setLoadingDetail(false))
  }

  useEffect(() => {
    if (expanded && !detail) loadDetail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  async function changeStatus(status: 'em_andamento' | 'pausado' | 'cancelado') {
    await api.updateProject(project.id, { status })
    onChanged()
  }

  const statusClass =
    project.status === 'finalizado' ? styles.statusFinalizado : project.status === 'cancelado' ? styles.statusCancelado : project.status === 'pausado' ? styles.statusPausado : styles.statusAndamento

  // Ações de status ficam visíveis na lista (sem precisar expandir) — só faz
  // sentido pra projeto ainda ativo (em andamento ou pausado).
  const isActive = project.status === 'em_andamento' || project.status === 'pausado'

  return (
    <div className={`${cards.card} ${project.status === 'finalizado' ? styles.cardFinalizado : ''}`}>
      <div className={styles.projectHeaderRow} onClick={onToggle}>
        {expanded ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
        <div className={styles.projectHeaderBody}>
          <div className={styles.projectHeaderTop}>
            <span className={styles.projectName}>{project.client.name}</span>
            <span className={`${styles.statusChip} ${statusClass}`}>{STATUS_LABEL[project.status]}</span>
            {isActive && (
              <div className={styles.projectHeaderActions} onClick={(e) => e.stopPropagation()}>
                {project.status === 'em_andamento' ? (
                  <button className={styles.iconBtn} onClick={() => changeStatus('pausado')} aria-label="Pausar projeto" title="Pausar projeto">
                    <Pause size={14} strokeWidth={2} />
                  </button>
                ) : (
                  <button className={styles.iconBtn} onClick={() => changeStatus('em_andamento')} aria-label="Retomar projeto" title="Retomar projeto">
                    <Play size={14} strokeWidth={2} />
                  </button>
                )}
                <button
                  className={styles.iconBtnDanger}
                  onClick={() => {
                    if (confirm(`Cancelar "${project.name}"? Isso não apaga recebimentos já lançados.`)) changeStatus('cancelado')
                  }}
                  aria-label="Cancelar projeto"
                  title="Cancelar projeto"
                >
                  <Ban size={14} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
          <div className={styles.projectHeaderBottom}>
            <div className={styles.projectHeaderMeta}>
              <span>{project.name}</span>
              <span>
                {formatDate(project.startDate)} {project.endDate ? `— ${formatDate(project.endDate)}` : ''}
              </span>
            </div>
            <div className={styles.projectHeaderValues}>
              <span className={styles.projectValue}>R$ {currency(project.contractValue)}</span>
              <span className={styles.projectSub}>
                recebido R$ {currency(project.received)} · falta R$ {currency(project.remaining)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className={styles.projectDetail}>
          <div className={styles.detailStats}>
            <div className={styles.detailStat}>
              <span className={cards.heroLabel}>Dias totais</span>
              <span className={cards.statValue}>{project.daysTotal ?? '—'}</span>
            </div>
            <div className={styles.detailStat}>
              <span className={cards.heroLabel}>Imposto</span>
              <span className={cards.statValue}>
                R$ {currency(project.taxAmount)}
                {project.taxEstimated && <span className={styles.pendingNote}> (estimativa 6%)</span>}
              </span>
            </div>
            <div className={styles.detailStat}>
              <span className={cards.heroLabel}>Custo fornecedor</span>
              <span className={cards.statValue}>R$ {currency(project.supplierCost)}</span>
            </div>
            <div className={styles.detailStat}>
              <span className={cards.heroLabel}>Líquido</span>
              <span className={cards.statValue}>R$ {currency(project.net)}</span>
            </div>
            <div className={styles.detailStat}>
              <span className={cards.heroLabel}>Rendimento/dia</span>
              <span className={cards.statValue}>{project.yieldPerDay !== null ? `R$ ${currency(project.yieldPerDay)}` : '—'}</span>
            </div>
          </div>

          {loadingDetail && <p className={styles.helperText}>Carregando...</p>}

          {detail && (
            <>
              <div className={styles.detailSection}>
                <div className={styles.detailSubheadingRow}>
                  <h4 className={styles.detailSubheading}>
                    <Receipt size={13} strokeWidth={2} /> Recebimentos
                  </h4>
                  <ReceiptsAddButton detail={detail} onChanged={() => { loadDetail(); onChanged() }} />
                </div>
                <ReceiptsList detail={detail} onChanged={() => { loadDetail(); onChanged() }} />
              </div>

              <div className={styles.detailSection}>
                <div className={styles.detailSubheadingRow}>
                  <h4 className={styles.detailSubheading}>
                    <Users size={13} strokeWidth={2} /> Fornecedores
                  </h4>
                  <SupplierAddButton detail={detail} suppliers={suppliers} onChanged={() => { loadDetail(); onChanged() }} />
                </div>
                <SupplierCostsList detail={detail} onChanged={() => { loadDetail(); onChanged() }} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ReceiptsList({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => void }) {
  async function handleDelete(id: string) {
    await api.deleteProjectReceipt(id)
    onChanged()
  }

  if (detail.receipts.length === 0) {
    return <p className={styles.helperText}>Nenhum recebimento ainda.</p>
  }

  return (
    <div className={styles.subList}>
      {detail.receipts.map((r) => (
        <div key={r.id} className={styles.subRow}>
          <span>Parcela {r.installmentNumber}</span>
          <span>R$ {currency(r.amount)}</span>
          <span className={styles.subRowMeta}>{formatDate(r.paymentDate)}</span>
          <button className={styles.iconBtn} onClick={() => handleDelete(r.id)} aria-label="Remover">
            <Trash2 size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  )
}

function ReceiptsAddButton({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  return (
    <>
      <button className={styles.addBtnSmall} onClick={() => setShowAdd(true)}>
        <Plus size={12} strokeWidth={2} /> Adicionar
      </button>
      {showAdd && (
        <AddReceiptModal
          detail={detail}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function AddReceiptModal({ detail, onClose, onSaved }: { detail: ProjectDetail; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!amount || !paymentDate) return
    setSaving(true)
    setError(null)
    try {
      await api.createProjectReceipt({
        projectId: detail.id,
        installmentNumber: detail.receipts.length + 1,
        amount: Number(amount),
        paymentDate,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Novo recebimento" subtitle={`${detail.client.name} — ${detail.name}`} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.formRow}>
          <Input label="Valor recebido (R$)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Data do pagamento" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className={cards.saveBtn} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SupplierCostsList({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => void }) {
  if (detail.supplierCosts.length === 0) {
    return <p className={styles.helperText}>Nenhum fornecedor nesse projeto.</p>
  }
  return (
    <div className={styles.subList}>
      {detail.supplierCosts.map((c) => (
        <SupplierCostRow key={c.id} cost={c} onChanged={onChanged} />
      ))}
    </div>
  )
}

function SupplierAddButton({
  detail,
  suppliers,
  onChanged,
}: {
  detail: ProjectDetail
  suppliers: Supplier[]
  onChanged: () => void
}) {
  const [showAddCost, setShowAddCost] = useState(false)
  return (
    <>
      <button className={styles.addBtnSmall} onClick={() => setShowAddCost(true)}>
        <Plus size={12} strokeWidth={2} /> Adicionar
      </button>
      {showAddCost && (
        <AddSupplierCostModal
          detail={detail}
          suppliers={suppliers}
          onClose={() => setShowAddCost(false)}
          onSaved={() => {
            setShowAddCost(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function AddSupplierCostModal({
  detail,
  suppliers,
  onClose,
  onSaved,
}: {
  detail: ProjectDetail
  suppliers: Supplier[]
  onClose: () => void
  onSaved: () => void
}) {
  const [supplierChoice, setSupplierChoice] = useState(suppliers[0]?.id ?? NEW_SUPPLIER)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [agreedAmount, setAgreedAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!agreedAmount) return
    setSaving(true)
    setError(null)
    try {
      let supplierId = supplierChoice
      if (supplierChoice === NEW_SUPPLIER) {
        if (!newSupplierName.trim()) {
          setError('Digite o nome do fornecedor novo.')
          setSaving(false)
          return
        }
        const supplier = await api.createSupplier(newSupplierName.trim())
        supplierId = supplier.id
      }
      await api.createProjectSupplierCost({ projectId: detail.id, supplierId, agreedAmount: Number(agreedAmount) })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Novo fornecedor no projeto" subtitle={`${detail.client.name} — ${detail.name}`} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.formRow}>
          <Select label="Fornecedor" value={supplierChoice} onChange={(e) => setSupplierChoice(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={NEW_SUPPLIER}>+ Novo fornecedor</option>
          </Select>
          {supplierChoice === NEW_SUPPLIER && (
            <Input label="Nome do fornecedor" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} />
          )}
          <Input label="Valor acordado (R$)" type="number" step="0.01" value={agreedAmount} onChange={(e) => setAgreedAmount(e.target.value)} />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className={cards.saveBtn} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SupplierCostRow({ cost, onChanged }: { cost: ProjectDetail['supplierCosts'][number]; onChanged: () => void }) {
  const [showAddPayment, setShowAddPayment] = useState(false)
  const paid = cost.payments.reduce((s, p) => s + p.amount, 0)

  return (
    <div className={styles.supplierBlock}>
      <div className={styles.subRow}>
        <span>{cost.supplier.name}</span>
        <span>R$ {currency(cost.agreedAmount)}</span>
        <span className={styles.subRowMeta}>
          pago R$ {currency(paid)} · falta R$ {currency(Math.max(0, cost.agreedAmount - paid))}
        </span>
        <button className={styles.smallBtn} onClick={() => setShowAddPayment(true)}>
          <Plus size={12} strokeWidth={2} /> Pagamento
        </button>
      </div>
      {cost.payments.length > 0 && (
        <div className={styles.subList}>
          {cost.payments.map((p) => (
            <div key={p.id} className={styles.subRow}>
              <span>Parcela {p.installmentNumber}</span>
              <span>R$ {currency(p.amount)}</span>
              <span className={styles.subRowMeta}>{formatDate(p.paymentDate)}</span>
            </div>
          ))}
        </div>
      )}

      {showAddPayment && (
        <AddSupplierPaymentModal
          cost={cost}
          onClose={() => setShowAddPayment(false)}
          onSaved={() => {
            setShowAddPayment(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function AddSupplierPaymentModal({
  cost,
  onClose,
  onSaved,
}: {
  cost: ProjectDetail['supplierCosts'][number]
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!amount || !paymentDate) return
    setSaving(true)
    setError(null)
    try {
      await api.createSupplierPayment({
        projectSupplierCostId: cost.id,
        installmentNumber: cost.payments.length + 1,
        amount: Number(amount),
        paymentDate,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Pagamento — ${cost.supplier.name}`} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.formRow}>
          <Input label="Valor pago (R$)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Data do pagamento" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.formActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className={cards.saveBtn} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- Modal genérico (overlay + folha) ----------

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h3 className={styles.modalTitle}>{title}</h3>
            {subtitle && <p className={styles.modalSubtitle}>{subtitle}</p>}
          </div>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------- Novo DAS ----------

function NewTaxPaymentForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [year, setYear] = useState(String(now.getFullYear()))
  const [preview, setPreview] = useState<{ totalRevenue: number; alreadyExists: boolean } | null>(null)
  const [amountPaid, setAmountPaid] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function loadPreview() {
    api.taxPaymentPreview(Number(month), Number(year)).then(setPreview)
  }

  useEffect(loadPreview, [month, year])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!amountPaid || !paymentDate) return
    setSaving(true)
    setError(null)
    try {
      await api.createTaxPayment({
        competenceMonth: Number(month),
        competenceYear: Number(year),
        amountPaid: Number(amountPaid),
        paymentDate,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`${cards.card} ${styles.form}`} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <Input label="Mês de competência" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} />
        <Input label="Ano" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        <div className={styles.previewNote}>
          {preview && (
            <>
              Faturou R$ {currency(preview.totalRevenue)} nesse mês.
              {preview.alreadyExists && ' Já existe um DAS pra essa competência — salvar vai substituir.'}
            </>
          )}
        </div>
      </div>
      <div className={styles.formRow}>
        <Input label="Valor pago no boleto (R$)" type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
        <Input label="Data do pagamento" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.formActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className={cards.saveBtn} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
