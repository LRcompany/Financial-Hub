import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import styles from './ModalShell.module.css'

/** Casca ÚNICA de toda modal do app (11/09, pedido do Luiz: "o scroll
 * precisa ser apenas dentro do conteúdo, não é pra mover a modal
 * inteira... isso tem que ser uma regra aplicada em todo o site pra todas
 * as modais"). Antes cada modal (`ContributionModal`, `BudgetReviewModal`,
 * `MonthlyReportModal`...) tinha seu próprio `overlay`/`sheet` copiado —
 * inclusive o BUG de `overflow-y: auto` no `.sheet` inteiro, que rolava
 * cabeçalho e tudo junto (nada fixo). Aqui o cabeçalho (título+subtítulo+
 * ações) fica FORA da área de scroll — só `.content` rola, com um separador
 * sutil que só aparece quando há de fato conteúdo cortado por cima
 * (`border-top` no scroll, sempre presente mas só visível junto da sombra
 * quando rolado — CSS puro, sem JS de scroll listener).
 *
 * `header`/`subtitle`/`headerActions` cobrem os 3 formatos de cabeçalho já
 * usados no app: só título (`BudgetReviewModal`), título+subtítulo
 * (`ContributionModal`), título+ação extra antes do X
 * (`MonthlyReportModal`, "Baixar PDF"). `footer` é opcional — pro par
 * Cancelar/Salvar que fecha um formulário inteiro (`ContributionModal`,
 * `BudgetReviewModal`), fica FORA do scroll junto do cabeçalho, sempre
 * visível; modal sem `footer` só tem cabeçalho fixo + conteúdo rolável.
 * `printable` é pro caso raro de modal que serve de relatório pra imprimir
 * (`MonthlyReportModal`, `window.print()`) — no papel o cabeçalho (título,
 * "Baixar PDF", X) some, e o conteúdo perde o limite de altura/scroll pra
 * paginar direito.
 * Nunca reimplementar overlay/sheet numa modal nova — sempre
 * `<ModalShell>`. */
export function ModalShell({
  title,
  subtitle,
  headerActions,
  footer,
  printable,
  onClose,
  maxWidth = 480,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  headerActions?: ReactNode
  footer?: ReactNode
  /** Modal também é uma tela de impressão (`window.print()`) — some o
   * cabeçalho/rodapé no papel e deixa o conteúdo paginar sem scroll. */
  printable?: boolean
  onClose: () => void
  /** Largura máxima da modal em desktop (px) — a maioria fica em 480 (padrão),
   * modal com tabela/gráfico largo (ex: relatório mensal) passa um valor maior. */
  maxWidth?: number
  children: ReactNode
}) {
  return (
    <div className={`${styles.overlay} ${printable ? styles.printableOverlay : ''}`} onClick={onClose}>
      <div className={`${styles.sheet} ${printable ? styles.printable : ''}`} style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        <div className={`${styles.header} ${printable ? styles.noPrint : ''}`}>
          <div className={styles.titleBlock}>
            <h3 className={styles.title}>{title}</h3>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <div className={styles.headerActions}>
            {headerActions}
            <IconButton onClick={onClose} aria-label="Fechar">
              <X size={16} strokeWidth={2} />
            </IconButton>
          </div>
        </div>
        <div className={styles.content}>{children}</div>
        {footer && <div className={`${styles.footer} ${printable ? styles.noPrint : ''}`}>{footer}</div>}
      </div>
    </div>
  )
}
