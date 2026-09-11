import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App.tsx'
import { AuthGate } from './auth/AuthGate.tsx'

// PWA instalado (standalone no iOS) raramente é "fechado" de verdade — o
// usuário só reabre pela home screen, retomando o processo que já estava
// rodando em memória. `registerType: 'autoUpdate'` (vite.config.ts) já troca
// o service worker sozinho em segundo plano a cada deploy, mas a ABA JÁ
// ABERTA continua rodando o JS antigo até um reload de verdade acontecer —
// sem isso, um fix já deployado pode nunca chegar em quem só resume o app
// (achado real, 08/09: Luiz via uma tela desatualizada mesmo depois do
// deploy). `controllerchange` dispara exatamente quando o novo SW assume —
// recarrega uma única vez nesse momento pra sempre pegar o bundle novo.
if ('serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthGate>
  </StrictMode>,
)
