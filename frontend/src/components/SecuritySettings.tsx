import { useEffect, useState, type FormEvent } from 'react'
import { Fingerprint, LogOut, Trash2 } from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import { api, type WebauthnCredentialInfo } from '../lib/api'
import { Input } from './Input'
import styles from './SecuritySettings.module.css'

/** Seção "Segurança" de Configurações — trocar a senha de 6 dígitos,
 * cadastrar/remover Face ID/Touch ID por aparelho, e sair. */
export function SecuritySettings() {
  const [credentials, setCredentials] = useState<WebauthnCredentialInfo[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSuccess, setPinSuccess] = useState(false)
  const [savingPin, setSavingPin] = useState(false)

  const [deviceLabel, setDeviceLabel] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)

  function loadCredentials() {
    api
      .webauthnCredentials()
      .then((creds) => {
        setCredentials(creds)
        setLoadError(null)
      })
      .catch(() => setLoadError('Não consegui carregar os aparelhos cadastrados.'))
  }

  useEffect(loadCredentials, [])

  async function handleChangePin(e: FormEvent) {
    e.preventDefault()
    setPinError(null)
    setPinSuccess(false)
    if (!/^\d{6}$/.test(newPin)) {
      setPinError('A nova senha precisa ter exatamente 6 dígitos.')
      return
    }
    setSavingPin(true)
    try {
      await api.changePin(currentPin, newPin)
      setCurrentPin('')
      setNewPin('')
      setPinSuccess(true)
    } catch (err) {
      setPinError((err as Error).message)
    } finally {
      setSavingPin(false)
    }
  }

  async function handleRegister() {
    setRegisterError(null)
    setRegistering(true)
    try {
      const optionsJSON = await api.webauthnRegisterOptions()
      const response = await startRegistration({ optionsJSON })
      await api.webauthnRegisterVerify(response, deviceLabel.trim() || 'Aparelho sem nome')
      setDeviceLabel('')
      loadCredentials()
    } catch (err) {
      // usuário cancelou o prompt do sistema — não é um erro real pra mostrar
      if ((err as Error).name !== 'NotAllowedError') setRegisterError((err as Error).message)
    } finally {
      setRegistering(false)
    }
  }

  async function handleDelete(id: string) {
    await api.deleteWebauthnCredential(id)
    loadCredentials()
  }

  async function handleLogout() {
    await api.authLogout()
    window.location.reload()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.block}>
        <h3 className={styles.subheading}>Trocar senha</h3>
        <form className={styles.pinForm} onSubmit={handleChangePin}>
          <Input
            label="Senha atual"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
          />
          <Input
            label="Nova senha (6 dígitos)"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
          <button className={styles.saveBtn} type="submit" disabled={savingPin}>
            Salvar nova senha
          </button>
        </form>
        {pinError && <p className={styles.error}>{pinError}</p>}
        {pinSuccess && <p className={styles.success}>Senha alterada.</p>}
      </div>

      <div className={styles.block}>
        <h3 className={styles.subheading}>Face ID / Touch ID</h3>
        <p className={styles.helperText}>
          Cadastre este aparelho pra desbloquear sem digitar a senha toda vez. A senha continua funcionando sempre,
          como alternativa.
        </p>
        {loadError && <p className={styles.error}>{loadError}</p>}
        {credentials.length > 0 && (
          <div className={styles.deviceList}>
            {credentials.map((c) => (
              <div key={c.id} className={styles.deviceRow}>
                <Fingerprint size={16} strokeWidth={2} className={styles.deviceIcon} />
                <div className={styles.deviceInfo}>
                  <span className={styles.deviceLabel}>{c.deviceLabel}</span>
                  <span className={styles.deviceMeta}>cadastrado {new Date(c.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <button className={styles.iconBtn} onClick={() => handleDelete(c.id)} aria-label="Remover aparelho">
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.registerForm}>
          <Input
            placeholder="Nome do aparelho (ex: iPhone do Luiz)"
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
          />
          <button className={styles.actionBtn} onClick={handleRegister} disabled={registering}>
            <Fingerprint size={14} strokeWidth={2} />
            {registering ? 'Aguardando...' : 'Cadastrar este aparelho'}
          </button>
        </div>
        {registerError && <p className={styles.error}>{registerError}</p>}
      </div>

      <button className={styles.logoutBtn} onClick={handleLogout}>
        <LogOut size={14} strokeWidth={2} />
        Sair
      </button>
    </div>
  )
}
