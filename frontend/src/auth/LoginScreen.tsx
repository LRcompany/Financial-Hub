import { useState } from 'react'
import { Fingerprint, Lock } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '../lib/api'
import { PinInput } from './PinInput'
import styles from './AuthScreens.module.css'

/** Tela de bloqueio — senha de 6 dígitos sempre disponível, Face ID/Touch ID
 * como atalho quando o aparelho já tem um cadastrado. O botão de Face ID
 * nunca dispara sozinho: WebAuthn pede um gesto do usuário, então é sempre
 * um toque explícito, nunca automático ao abrir a tela. */
export function LoginScreen({ hasWebauthnCredential, onDone }: { hasWebauthnCredential: boolean; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)

  async function handlePin(pin: string) {
    setError(null)
    setBusy(true)
    try {
      await api.authLogin(pin)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setResetKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  async function handleFaceId() {
    setError(null)
    setBusy(true)
    try {
      const optionsJSON = await api.webauthnLoginOptions()
      const response = await startAuthentication({ optionsJSON })
      await api.webauthnLoginVerify(response)
      onDone()
    } catch (err) {
      // usuário cancelou o prompt do sistema (ex: apertou "Cancelar" no Face
      // ID) não é bem um "erro" pra mostrar em vermelho — só volta pro PIN
      const message = (err as Error).name === 'NotAllowedError' ? null : (err as Error).message
      if (message) setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <Lock size={32} strokeWidth={1.5} className={styles.icon} />
        <h1 className={styles.title}>Command OS</h1>
        <p className={styles.subtitle}>Digite sua senha de 6 dígitos.</p>
        <PinInput resetKey={resetKey} onComplete={handlePin} disabled={busy} />
        {error && <p className={styles.error}>{error}</p>}
        {hasWebauthnCredential && (
          <button className={styles.faceIdBtn} onClick={handleFaceId} disabled={busy}>
            <Fingerprint size={16} strokeWidth={2} />
            Desbloquear com Face ID / Touch ID
          </button>
        )}
      </div>
    </div>
  )
}
