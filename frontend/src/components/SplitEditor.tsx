import { Trash2 } from 'lucide-react'
import { type LeafCategoryOption } from '../lib/api'
import { currency } from '../lib/format'
import { Input } from './Input'
import { Select } from './Select'
import styles from './SplitEditor.module.css'

export interface SplitRowValue {
  categoryId: string
  amount: string
}

export const SPLIT_TOLERANCE = 0.01

/** Duas linhas iniciais pra começar a dividir um valor — a primeira já vem
 * com o valor cheio (e a categoria já escolhida, se tinha uma), o Luiz só
 * precisa "tirar" o pedaço das outras categorias, não montar tudo do zero. */
export function initialSplitRows(totalAmount: number, firstCategoryId = ''): SplitRowValue[] {
  return [
    { categoryId: firstCategoryId, amount: totalAmount.toFixed(2) },
    { categoryId: '', amount: '0' },
  ]
}

export function splitRemaining(rows: SplitRowValue[], totalAmount: number): number {
  const allocated = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  return totalAmount - allocated
}

/** null = válido, pronto pra salvar. String = mensagem de erro pra mostrar. */
export function validateSplitRows(rows: SplitRowValue[], totalAmount: number): string | null {
  if (rows.some((r) => !r.categoryId || !(Number(r.amount) > 0))) {
    return 'Toda linha precisa de categoria e um valor maior que zero.'
  }
  const remaining = splitRemaining(rows, totalAmount)
  if (Math.abs(remaining) > SPLIT_TOLERANCE) {
    return remaining > 0
      ? `Falta distribuir R$ ${currency(remaining)}.`
      : `Passou R$ ${currency(Math.abs(remaining))} do valor da transação.`
  }
  return null
}

/** Editor de "dividir um valor real em N categorias" (14/09, pedido do
 * Luiz: "o boleto do aluguel vem com água, gás, internet e seguro juntos,
 * como resolver isso?") — N linhas categoria+valor cuja soma precisa bater
 * com `totalAmount`. Componente ÚNICO usado em `TransactionEditModal`
 * (transação já lançada, "Todas as transações do mês"/"Últimas
 * transações") e em `TransactionReviewModal` ("Compras sem categoria") —
 * mesmo conceito, dois lugares que precisam dividir uma transação, nunca
 * duas versões da mesma UI. Estado (`rows`) fica com quem chama — esse
 * componente só desenha e valida, cada host decide como/quando salvar. */
export function SplitEditor({
  rows,
  onChange,
  categories,
  totalAmount,
  disabled,
}: {
  rows: SplitRowValue[]
  onChange: (rows: SplitRowValue[]) => void
  categories: LeafCategoryOption[]
  totalAmount: number
  disabled?: boolean
}) {
  function updateRow(index: number, field: keyof SplitRowValue, value: string) {
    onChange(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    onChange([...rows, { categoryId: '', amount: '0' }])
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  const remaining = splitRemaining(rows, totalAmount)
  const isValid = Math.abs(remaining) <= SPLIT_TOLERANCE

  return (
    <div className={styles.splitBlock}>
      {rows.map((row, i) => (
        <div className={styles.splitRow} key={i}>
          <Select
            aria-label="Categoria"
            value={row.categoryId}
            onChange={(e) => updateRow(i, 'categoryId', e.target.value)}
            disabled={disabled}
            className={styles.splitCategorySelect}
          >
            <option value="" disabled>
              Categoria
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Valor"
            type="number"
            step="0.01"
            value={row.amount}
            onChange={(e) => updateRow(i, 'amount', e.target.value)}
            disabled={disabled}
            className={styles.splitAmountInput}
          />
          <button
            type="button"
            className={styles.splitRemoveBtn}
            onClick={() => removeRow(i)}
            disabled={disabled || rows.length <= 2}
            aria-label="Remover categoria"
            title="Remover categoria"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      ))}

      <button type="button" className={styles.splitAddBtn} onClick={addRow} disabled={disabled}>
        + Adicionar categoria
      </button>

      <p className={isValid ? styles.splitRemainingOk : styles.splitRemainingWarn}>
        {isValid
          ? 'Valores batem com o total da transação.'
          : remaining > 0
            ? `Falta distribuir R$ ${currency(remaining)}.`
            : `R$ ${currency(Math.abs(remaining))} acima do valor da transação.`}
      </p>
    </div>
  )
}
