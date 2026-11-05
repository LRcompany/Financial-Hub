import { AlertTriangle } from 'lucide-react'
import styles from './Badge.module.css'

/** Pill azul "N/Total" de uma compra parcelada — ÚNICO lugar que define essa
 * aparência (pedido do Luiz, 11/09: "onde aparece o número de parcela, tem
 * que vir assim, em TODOS os lugares" — tabelas, listas, modais). Não
 * renderiza nada quando não sabemos a posição (parcela sem total conhecido,
 * ver `buildInstallmentPositions`). */
export function InstallmentBadge({ number, total }: { number?: number | null; total?: number | null }) {
  if (number == null || total == null) return null
  return <span className={styles.installment}>{number}/{total}</span>
}


/** Pill cinza "sem meta" (27/10) — gasto numa categoria sem meta no mês. Conta
 * no total do Orçamento igual a qualquer gasto, mas não é "estourou" (não tinha
 * o que estourar) — por isso nunca o `OverBudgetIcon` nesse caso. */
export function NoTargetTag() {
  return <span className={styles.noTarget}>sem meta</span>
}

/** Regra ÚNICA de "estourou" (27/10): só categoria COM meta no mês, e gasto
 * acima dela (meta R$0 com gasto também estoura). Sem meta = `NoTargetTag`. */
export function isOverBudget(c: { hasTarget: boolean; spent: number; planned: number }): boolean {
  return c.hasTarget && c.spent > c.planned
}

/** Ícone "estourou" — círculo vermelho-claro com o `AlertTriangle` dentro,
 * ÚNICO jeito de marcar "isso passou do planejado" em todo o app (pedido do
 * Luiz, 11/09: "joga o icone num círculo vermelho claro, o ícone segue o
 * tamanho padrão que usamos em tudo" — 14px, regra global de ícone de
 * interface). Sempre depois do texto/valor (nunca antes) — reordenado nessa
 * mesma data, antes ficava `<AlertTriangle/>{valor}`. Substitui o
 * `<AlertTriangle className={styles.overIcon}>` solto que estava duplicado
 * em Dashboard/Orçamento/CategoryBreakdownModal/MonthlyReportModal. */
export function OverBudgetIcon() {
  return (
    <span className={styles.overBudgetIcon}>
      <AlertTriangle size={14} strokeWidth={2} />
    </span>
  )
}
