import { useEffect, useRef, useState } from 'react'
import styles from './PinInput.module.css'

/** 6 caixas de dígito, foco avança sozinho, backspace volta — o padrão que
 * todo app de banco usa pra senha numérica. Zera e refoca no primeiro dígito
 * sempre que `resetKey` muda (usado pra limpar depois de um erro). */
export function PinInput({
  length = 6,
  onComplete,
  disabled = false,
  resetKey,
}: {
  length?: number
  onComplete: (pin: string) => void
  disabled?: boolean
  resetKey?: unknown
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(''))
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    setDigits(Array(length).fill(''))
    inputRefs.current[0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  function updateDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = clean
    setDigits(next)
    if (clean && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
    if (next.every((d) => d !== '')) {
      onComplete(next.join(''))
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (!text) return
    e.preventDefault()
    const next = Array(length).fill('')
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setDigits(next)
    if (text.length === length) onComplete(text)
    else inputRefs.current[text.length]?.focus()
  }

  return (
    <div className={styles.row}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el
          }}
          className={styles.box}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={d}
          disabled={disabled}
          onChange={(e) => updateDigit(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  )
}
