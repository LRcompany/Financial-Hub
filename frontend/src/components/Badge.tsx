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

/** Pill cinza "projetado" — estilo FIXO, nunca muda de cor (pedido do Luiz,
 * 11/09: "a tag projetado precisa ser padrão em todo o site, não mude de
 * cor. É um estilo fixo. Trabalhe em cinza."). Usar em qualquer lugar que
 * mostre um valor com fatia de UpcomingInstallment ainda não confirmada. */
export function ProjectedTag() {
  return <span className={styles.projected}>projetado</span>
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
