import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { api, type BudgetSummary, type WealthOverview, type ProjectsSummary, type BudgetCategory } from '../lib/api'
import { currency } from '../lib/format'
import { Money } from './Money'
import { ClientPieChart } from './ClientPieChart'
import { RankedBarList } from './RankedBarList'
import { SmoothLineChart } from './SmoothLineChart'
import { MonthDelta } from './MonthDelta'
import { InstallmentBadge, ProjectedTag, OverBudgetIcon } from './Badge'
import { ModalShell } from './ModalShell'
import styles from './MonthlyReportModal.module.css'

const MONTH_NAMES_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Agrega gasto por categoria-mãe pra alimentar a pizza e o "quem mais
 * gastou" — mesma função de Dashboard.tsx, duplicada de propósito (pequena,
 * não vale importar só por isso). */
function spentByParent(categories: BudgetCategory[]) {
  const map = new Map<string, { spent: number; previousSpent: number }>()
  for (const c of categories) {
    const key = c.parentName ?? 'Outras'
    const existing = map.get(key) ?? { spent: 0, previousSpent: 0 }
    existing.spent += c.spent
    existing.previousSpent += c.previousSpent
    map.set(key, existing)
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, value: v.spent, previousValue: v.previousSpent }))
    .sort((a, b) => b.value - a.value)
}

/** Conteúdo do relatório mensal, numa modal — pedido do Luiz (09/09): "pra não
 * me confundir, em configurações não precisa exibir as infos do relatório, só
 * deixe o mês, visualizar numa modal e baixar pdf". O controle de mês fica em
 * `MonthlyReport.tsx` (a seção fixa de Configurações); essa modal só recebe
 * `month`/`year` já resolvidos e mostra o conteúdo. `autoPrint` dispara
 * `window.print()` sozinho assim que os dados carregam — usado pelo botão
 * "Baixar PDF" do controle, que abre a modal já nesse modo. */
export function MonthlyReportModal({
  month,
  year,
  autoPrint,
  onClose,
}: {
  month: number
  year: number
  autoPrint?: boolean
  onClose: () => void
}) {
  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [wealth, setWealth] = useState<WealthOverview | null>(null)
  const [projects, setProjects] = useState<ProjectsSummary | null>(null)
  const [printed, setPrinted] = useState(false)

  useEffect(() => {
    setBudget(null)
    setWealth(null)
    setProjects(null)
    api.budgetSummary({ month, year }).then(setBudget)
    api.wealthOverview({ month, year }).then(setWealth)
    api.projectsSummary({ month, year }).then(setProjects)
  }, [month, year])

  const loading = !budget || !wealth || !projects

  useEffect(() => {
    if (autoPrint && !loading && !printed) {
      setPrinted(true)
      window.print()
    }
  }, [autoPrint, loading, printed])

  function downloadPdf() {
    window.print()
  }

  const monthLabel = `${MONTH_NAMES_FULL[month - 1]} de ${year}`

  const essentialSpent = budget?.categories.filter((c) => c.kind === 'essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const nonEssentialSpent = budget?.categories.filter((c) => c.kind === 'non_essential').reduce((s, c) => s + c.spent, 0) ?? 0
  const previousTotalSpent = budget?.categories.reduce((s, c) => s + c.previousSpent, 0) ?? 0
  const diffFromPlanned = budget ? budget.totalPlanned - budget.totalSpent : 0
  const withinBudget = diffFromPlanned >= 0

  const byParent = budget ? spentByParent(budget.categories) : []
  const pieData = byParent.filter((p) => p.value > 0)
  // Categoria que mais CRESCEU vs mês anterior (maior delta positivo) —
  // diferente de "quem mais gastou" (uma categoria pode ser sempre a maior
  // sem ter crescido nada esse mês).
  const fastestGrowingCategory = [...pieData]
    .map((p) => ({ ...p, delta: p.value - p.previousValue }))
    .filter((p) => p.previousValue > 0 && p.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0]

  // Categoria(s) que estourou(aram) o planejado — mesma regra de "over" usada
  // no Dashboard/Orçamento/modal de detalhamento (10/09: precisa ser global,
  // não só onde foi implementada primeiro), aqui aplicada ao relatório.
  // Sem `c.planned > 0` (11/09, achado pelo Luiz): meta zerada com gasto
  // real também estourou.
  const overBudgetCategories = (budget?.categories ?? [])
    .filter((c) => c.spent > c.planned)
    .sort((a, b) => b.spent - b.planned - (a.spent - a.planned))
  const totalProjected = budget?.totalProjected ?? 0

  const bestMover = wealth?.movers.filter((m) => m.changePct > 0).sort((a, b) => b.changePct - a.changePct)[0] ?? null
  const allocationData = wealth?.allocation.filter((a) => a.value > 0) ?? []

  return (
    <ModalShell
      title={<span className={styles.reportTitle}>Relatório de {monthLabel}</span>}
      headerActions={
        <button className={styles.pdfBtn} onClick={downloadPdf} disabled={loading}>
          <Download size={13} strokeWidth={2} />
          Baixar PDF
        </button>
      }
      printable
      onClose={onClose}
    >
      {loading && <p className={styles.loading}>Carregando relatório...</p>}

      {!loading && (
        <>
          <p className={styles.printTitle}>Command OS — Relatório de {monthLabel}</p>

          {/* ---------- Orçamento ---------- */}
            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Orçamento</h4>
              <div className={styles.statGrid}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Total gasto</span>
                  <span className={styles.statValue}><Money>R$ {currency(budget!.totalSpent)}</Money></span>
                  {/* Mesma nota de "Onde meu dinheiro foi" em Orçamento (10/09)
                      — o total já inclui parcela projetada, precisa avisar
                      aqui também pra não parecer um número "de outro lugar".
                      Unificado (11/09) pra usar a mesma tag `ProjectedTag`
                      do resto do site, em vez da palavra solta em texto. */}
                  {totalProjected > 0 && (
                    <span className={styles.projectedNote}>
                      dos quais <Money>R$ {currency(totalProjected)}</Money> <ProjectedTag />
                    </span>
                  )}
                  {previousTotalSpent > 0 && <MonthDelta current={budget!.totalSpent} previous={previousTotalSpent} higherIsBetter={false} />}
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Recebido</span>
                  <span className={styles.statValue}><Money>R$ {currency(budget!.totalIncome)}</Money></span>
                  {budget!.previousTotalIncome > 0 && (
                    <MonthDelta current={budget!.totalIncome} previous={budget!.previousTotalIncome} higherIsBetter />
                  )}
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{withinBudget ? 'Sobrou' : 'Estourou'}</span>
                  {/* Unificado (11/09) com a regra do design system: nunca cor
                      no número, só o ícone de alerta acusa problema (mesmo
                      padrão do highlight "Estourou o planejado em..." logo
                      abaixo, e do resto do app). "Sobrou" não precisa de
                      marca nenhuma — alerta é só pra problema. */}
                  <span className={styles.statValue}>
                    <Money>R$ {currency(Math.abs(diffFromPlanned))}</Money>
                    {!withinBudget && <OverBudgetIcon />}
                  </span>
                </div>
              </div>
              <div className={styles.splitRow}>
                <span>Essencial: <Money>R$ {currency(essentialSpent)}</Money></span>
                <span>Não essencial: <Money>R$ {currency(nonEssentialSpent)}</Money></span>
              </div>

              {/* "Economia da meta diária" (15/09, pedido do Luiz: "vou saber
                  o quanto estou economizando nos meses... esses valores com
                  certeza têm que aparecer no meu relatório mensal") — do
                  PERÍODO do relatório (`daysWithGoal`/`dailyGoalSaved`),
                  nunca "agora" (esses campos, sem sufixo "ThisMonth", são
                  escopados pelo mês/ano da query — ver comentário em
                  api.ts). Comparação com o mês anterior só quando ele
                  também teve economia de verdade, mesmo padrão do resto do
                  relatório. */}
              {budget!.daysWithGoal > 0 && (
                <p className={styles.highlight}>
                  Economia da meta diária:{' '}
                  <strong>
                    {budget!.daysUnderGoal} de {budget!.daysWithGoal} dia{budget!.daysWithGoal === 1 ? '' : 's'} abaixo da meta
                  </strong>
                  {budget!.dailyGoalSaved > 0 && (
                    <>
                      {' '}
                      — <Money>R$ {currency(budget!.dailyGoalSaved)}</Money> economizados
                      {budget!.previousDailyGoalSaved > 0 && (
                        <MonthDelta current={budget!.dailyGoalSaved} previous={budget!.previousDailyGoalSaved} higherIsBetter />
                      )}
                    </>
                  )}
                </p>
              )}

              {pieData.length > 0 ? (
                <>
                  <div className={styles.chartWrap}>
                    <ClientPieChart data={pieData} />
                  </div>
                  {/* Lista rankeada de TODAS as categorias (15/09, pedido do
                      Luiz: "cadê o gráfico das categorias em orçamento? onde
                      eu gastei mais?") — antes só tinha a frase da categoria
                      #1 isolada; agora dá pra comparar todas, maior primeiro,
                      mesmo componente já usado noutros rankings do app. */}
                  <div className={styles.chartWrap}>
                    <RankedBarList data={pieData} />
                  </div>
                  {fastestGrowingCategory && (
                    <p className={styles.highlight}>
                      Categoria que mais cresceu: <strong>{fastestGrowingCategory.label}</strong> (
                      <Money>+R$ {currency(fastestGrowingCategory.delta)}</Money> vs. mês anterior)
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>Nenhum gasto categorizado em {monthLabel} ainda.</p>
              )}

              {/* Estourou o planejado — só o ícone acusa (pedido do Luiz,
                  11/09: "deixa apenas o alerta em vermelho"), mesma marca
                  usada em toda a plataforma pra essa situação. */}
              {overBudgetCategories.length > 0 && (
                <p className={styles.highlight}>
                  Estourou o planejado em:{' '}
                  {/* `key={c.categoryId}`, não `c.name` (achado real, 15/09:
                      duas categorias-folha com o mesmo nome — ex:
                      "Equipamentos" em dois grupos-pai diferentes — geravam
                      key duplicada, erro no console do React). */}
                  {overBudgetCategories.map((c, i) => (
                    <span key={c.categoryId}>
                      {i > 0 && ', '}
                      {c.name} (<Money>+R$ {currency(c.spent - c.planned)}</Money>)
                    </span>
                  ))}
                  <OverBudgetIcon />
                </p>
              )}

              {budget!.biggestPurchase && (
                <p className={styles.highlight}>
                  Maior compra: <strong>{budget!.biggestPurchase.description}</strong>
                  <InstallmentBadge number={budget!.biggestPurchase.installmentNumber} total={budget!.biggestPurchase.totalInstallments} />
                  {' — '}
                  <Money>R$ {currency(budget!.biggestPurchase.amount)}</Money>
                  {budget!.biggestPurchase.category ? ` · ${budget!.biggestPurchase.category}` : ''} · {formatDate(budget!.biggestPurchase.date)}
                </p>
              )}
            </section>

            {/* ---------- Patrimônio ---------- */}
            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Patrimônio</h4>
              {wealth!.hasData ? (
                <>
                  <div className={styles.statGrid}>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>Patrimônio total</span>
                      <span className={styles.statValue}><Money>R$ {currency(wealth!.total ?? 0)}</Money></span>
                      {wealth!.previousTotal != null && wealth!.previousTotal > 0 && (
                        <MonthDelta current={wealth!.total ?? 0} previous={wealth!.previousTotal} higherIsBetter />
                      )}
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>Investido no mês</span>
                      <span className={styles.statValue}>
                        {wealth!.investedThisMonth != null ? <Money>{`R$ ${currency(wealth!.investedThisMonth)}`}</Money> : '—'}
                      </span>
                      {wealth!.investedThisMonth != null && wealth!.investedLastMonth != null && wealth!.investedLastMonth > 0 && (
                        <MonthDelta current={wealth!.investedThisMonth} previous={wealth!.investedLastMonth} higherIsBetter />
                      )}
                    </div>
                  </div>

                  {/* Curva de evolução (15/09, pedido do Luiz: "ele ainda
                      está muito pobre visualmente. Sem gráficos") — antes só
                      tinha o número de "Patrimônio total", sem noção de
                      tendência nenhuma. Mesmo `SmoothLineChart` da tela de
                      Patrimônio, sem `threshold` (não faz sentido meta pra
                      patrimônio). */}
                  {wealth!.evolution.length >= 2 && (
                    <div className={styles.chartWrap}>
                      <SmoothLineChart
                        values={wealth!.evolution.map((e) => e.value)}
                        labels={wealth!.evolution.map((e) => e.label)}
                        gradientId="reportWealthEvolution"
                        height={70}
                      />
                    </div>
                  )}

                  {allocationData.length > 0 && (
                    <div className={styles.chartWrap}>
                      <ClientPieChart data={allocationData} />
                    </div>
                  )}

                  <p className={styles.highlight}>
                    {bestMover ? (
                      <>
                        Categoria que mais rendeu: <strong>{bestMover.category}</strong> (+{bestMover.changePct.toFixed(1)}%)
                      </>
                    ) : (
                      'Nenhum ativo com alta este mês.'
                    )}
                  </p>
                </>
              ) : (
                <p className={styles.emptyNote}>Sem dado de patrimônio ainda.</p>
              )}
            </section>

            {/* ---------- Projetos ---------- */}
            <section className={styles.block}>
              <h4 className={styles.blockTitle}>Projetos</h4>
              {projects!.receivedThisMonth > 0 ||
              projects!.bestProjectThisMonth ||
              projects!.outstanding > 0 ||
              projects!.deliveredThisMonth.length > 0 ? (
                <>
                  <div className={styles.statGrid}>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>Recebido no mês</span>
                      <span className={styles.statValue}><Money>R$ {currency(projects!.receivedThisMonth)}</Money></span>
                      {projects!.receivedLastMonth > 0 && (
                        <MonthDelta current={projects!.receivedThisMonth} previous={projects!.receivedLastMonth} higherIsBetter />
                      )}
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.statLabel}>A receber</span>
                      <span className={styles.statValue}><Money>R$ {currency(projects!.outstanding)}</Money></span>
                    </div>
                  </div>
                  {projects!.bestProjectThisMonth && (
                    <p className={styles.highlight}>
                      Projeto que mais rendeu: <strong>{projects!.bestProjectThisMonth.name}</strong> (
                      <Money>R$ {currency(projects!.bestProjectThisMonth.received)}</Money>)
                    </p>
                  )}
                  {/* "Projetos entregues" (15/09, pedido do Luiz: "cadê os
                      projetos entregues?") — entrega não é um campo manual,
                      é derivada de quando o total recebido bateu o valor do
                      contrato (confirmado com o Luiz: "a entrega está
                      relacionada ao pagamento total do projeto"). Vazio nos
                      meses sem nenhum projeto fechado — nada aparece, sem
                      "nenhum projeto entregue" genérico pra não poluir um
                      relatório que já tem outros números. */}
                  {projects!.deliveredThisMonth.length > 0 && (
                    <>
                      <h5 className={styles.subBlockTitle}>Projetos entregues</h5>
                      <ul className={styles.deliveredList}>
                        {projects!.deliveredThisMonth.map((p) => (
                          <li key={p.id} className={styles.deliveredRow}>
                            <span>
                              <strong>{p.name}</strong> · {p.client}
                            </span>
                            <span>
                              <Money>R$ {currency(p.contractValue)}</Money>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>Sem recebimento de projeto registrado em {monthLabel} ainda.</p>
              )}
            </section>
        </>
      )}
    </ModalShell>
  )
}
