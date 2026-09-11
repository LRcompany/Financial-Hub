import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'command-os-privacy-mode'

interface PrivacyContextValue {
  hidden: boolean
  toggle: () => void
}

const PrivacyContext = createContext<PrivacyContextValue>({ hidden: false, toggle: () => {} })

/** Modo privacidade (pedido do Luiz, 11/09: "quero mostrar a plataforma pra
 * alguém sem que a pessoa veja meus números de fato"). Um toggle global (ícone
 * de olho no header) borra todo VALOR em R$ do app inteiro — nunca rótulo,
 * categoria, percentual, data ou quantidade, só o dinheiro. Persiste em
 * localStorage (conveniência por aparelho, não precisa sincronizar entre
 * dispositivos nem servidor). */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0')
    } catch {
      // localStorage indisponível (modo privado, storage bloqueado) — o
      // toggle continua funcionando nessa sessão, só não persiste.
    }
  }, [hidden])

  return <PrivacyContext.Provider value={{ hidden, toggle: () => setHidden((v) => !v) }}>{children}</PrivacyContext.Provider>
}

export function usePrivacy() {
  return useContext(PrivacyContext)
}
