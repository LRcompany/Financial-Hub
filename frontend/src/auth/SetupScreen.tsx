import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { PinInput } from './PinInput'
import styles from './AuthScreens.module.css'

/** Primeiro acesso — só aparece enquanto não existe nenhuma senha
 * configurada no servidor (AppAuth vazio). Pede a senha 2x (não tem como
 * "esqueci a senha" num app de usuário único, então evita erro de digitação
 * na hora de criar). */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'first' | 'confirm'>('first')
  const [firstPin, setFirstPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [saving, setSaving] = useState(false)

  function handleFirst(pin: string) {
    setFirstPin(pin)
    setStep('confirm')
    setResetKey((k) => k + 1)
  }

  async function handleConfirm(pin: string) {
    if (pin !== firstPin) {
      setError('As senhas não bateram — tente de novo.')
      setStep('first')
      setFirstPin('')
      setResetKey((k) => k + 1)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await api.authSetup(pin)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setStep('first')
      setFirstPin('')
      setResetKey((k) => k + 1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <ShieldCheck size={32} strokeWidth={1.5} className={styles.icon} />
        <h1 className={styles.title}>Bem-vindo ao Command OS</h1>
        <p className={styles.subtitle}>
          {step === 'first'
            ? 'Antes de começar, defina uma senha de 6 dígitos pra proteger seus dados.'
            : 'Digite a mesma senha de novo pra confirmar.'}
        </p>
        <PinInput resetKey={resetKey} onComplete={step === 'first' ? handleFirst : handleConfirm} disabled={saving} />
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}
