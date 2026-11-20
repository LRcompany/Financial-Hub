// "Livre para gastar hoje" e "Fecha em ~R$ X" (20/11) — ver
// backend/src/services/dailyAllowance.ts e /budget-summary. Mesmo componente
// no Dashboard e no Orçamento (o card de meta diária existe nos dois).
import type { BudgetSummary } from '../lib/api'
import { Money } from './Money'
import { currency } from '../lib/format'

export function FreeTodayLine({ budget, className }: { budget: BudgetSummary; className?: string }) {
  const f = budget.freeToday
  if (!f) return null
  const formula =
    `(meta R$ ${currency(f.goal)} × dias do mês − gasto variável até ontem R$ ${currency(f.variableSpentUntilYesterday)}` +
    ` − parcelas do mês R$ ${currency(f.installmentsThisMonth)}) ÷ ${f.daysLeft} dia${f.daysLeft === 1 ? '' : 's'} que faltam, contando hoje.` +
    ' Aluguel, contas e o que estiver "fora da meta diária" em Categorias não entram.'
  return (
    <div className={className} title={formula}>
      {f.amount >= 0 ? (
        <span>
          Livre para gastar hoje <strong><Money>R$ {currency(f.amount)}</Money></strong>
        </span>
      ) : (
        <span>
          Livre para gastar hoje: <strong>passou <Money>R$ {currency(-f.amount)}</Money></strong>
        </span>
      )}
    </div>
  )
}

const whole = (v: number) => Math.round(v).toLocaleString('pt-BR')

export function ProjectedMonthLine({ budget, className }: { budget: BudgetSummary; className?: string }) {
  if (budget.projectedMonthTotal == null) return null
  const diff = budget.projectedMonthTotal - budget.totalPlanned
  const pending = budget.pendingBills
  const title =
    pending.length > 0
      ? `Já lançado R$ ${currency(budget.totalSpent)} + contas com meta ainda não lançadas: ` +
        pending.map((p) => `${p.path} R$ ${currency(p.planned)}`).join(', ')
      : `Já lançado R$ ${currency(budget.totalSpent)} — toda conta com meta já caiu esse mês.`
  return (
    <span className={className} title={title}>
      Fecha em ~<Money>R$ {whole(budget.projectedMonthTotal)}</Money> (
      {Math.abs(diff) < 0.5 ? (
        'igual ao planejado'
      ) : (
        <>
          <Money>R$ {whole(Math.abs(diff))}</Money> {diff > 0 ? 'acima' : 'abaixo'} do planejado
        </>
      )}
      )
    </span>
  )
}
