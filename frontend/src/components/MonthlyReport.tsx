import { useState } from 'react'
import { Download, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { MonthlyReportModal } from './MonthlyReportModal'
import styles from './MonthlyReport.module.css'

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Controle fixo em Configurações — só o seletor de mês + 2 botões. Pedido do
 * Luiz (09/09): "pra não me confundir, em configurações não precisa exibir as
 * infos do relatório, só deixe o mês, visualizar numa modal e baixar pdf". O
 * conteúdo de verdade (todo o comparativo de Orçamento/Patrimônio/Projetos)
 * mora em `MonthlyReportModal.tsx` — esse componente só resolve QUAL mês e
 * abre a modal (com ou sem impressão automática). */
export function MonthlyReport() {
  const now = new Date()
  // Mês ANTERIOR como ponto de partida — é o mês "fechado" mais recente, o
  // mesmo padrão que o banner do Dashboard já usava antes.
  const initial = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [month, setMonth] = useState(initial.getMonth() + 1)
  const [year, setYear] = useState(initial.getFullYear())
  const [modal, setModal] = useState<'view' | 'print' | null>(null)

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setMonth(m)
    setYear(y)
  }

  return (
    <div className={styles.root}>
      <div className={styles.monthNav}>
        <button className={styles.navBtn} onClick={() => changeMonth(-1)} aria-label="Mês anterior">
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span className={styles.monthLabel}>
          {MONTH_NAMES[month - 1]}/{year}
        </span>
        <button className={styles.navBtn} onClick={() => changeMonth(1)} aria-label="Próximo mês">
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.actions}>
        <button className={styles.viewBtn} onClick={() => setModal('view')}>
          <FileText size={13} strokeWidth={2} />
          Visualizar
        </button>
        <button className={styles.pdfBtn} onClick={() => setModal('print')}>
          <Download size={13} strokeWidth={2} />
          Baixar PDF
        </button>
      </div>

      {modal && (
        <MonthlyReportModal month={month} year={year} autoPrint={modal === 'print'} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
