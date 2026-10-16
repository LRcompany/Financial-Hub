import { useEffect, useState, type ReactNode } from 'react'
import { api, type AuthStatus } from '../lib/api'
import { SetupScreen } from './SetupScreen'
import { LoginScreen } from './LoginScreen'

/** Porta de entrada do app inteiro — nada do resto renderiza antes de saber
 * o estado de autenticação. 3 estados possíveis: sem senha configurada
 * ainda (primeiro acesso), senha configurada mas sessão não válida (tela de
 * bloqueio), ou autenticado (deixa passar). */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState(false)

  function reload() {
    api
      .authStatus()
      .then((s) => {
        setStatus(s)
        setError(false)
      })
      .catch(() => setError(true))
  }

  useEffect(reload, [])

  if (error) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        Não consegui falar com o servidor. Verifique sua conexão e recarregue a página.
      </div>
    )
  }

  if (!status) return null

  if (!status.hasPinConfigured) {
    return <SetupScreen onDone={reload} />
  }

  if (!status.authenticated) {
    return <LoginScreen hasWebauthnCredential={status.hasWebauthnCredential} onDone={reload} />
  }

  return <>{children}</>
}
