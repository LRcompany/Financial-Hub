import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Home, Receipt, Wallet, Briefcase, SlidersHorizontal, Search, Bell, RefreshCw } from 'lucide-react'
import styles from './AppLayout.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/orcamento', label: 'Orçamento', icon: Receipt },
  { to: '/patrimonio', label: 'Patrimônio', icon: Wallet },
  { to: '/projetos', label: 'Projetos', icon: Briefcase },
  { to: '/configuracoes', label: 'Configurações', icon: SlidersHorizontal },
]

// Nome configurável no build (VITE_DISPLAY_NAME) — default "Luiz" pro app
// real, sobrescrito na instância de demonstração (dado fake) via
// .env.production próprio, sem precisar de outra branch/código.
const DISPLAY_NAME = import.meta.env.VITE_DISPLAY_NAME ?? 'Luiz'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return `Bom dia, ${DISPLAY_NAME}`
  if (hour < 18) return `Boa tarde, ${DISPLAY_NAME}`
  return `Boa noite, ${DISPLAY_NAME}`
}

export function AppLayout() {
  const [refreshing, setRefreshing] = useState(false)

  // Não existe cache no front — toda página já busca direto da API a cada
  // load. "Atualizar" aqui é recarregar a página inteira, que força esse
  // busca de novo em tudo que está na tela. O que ESSE botão não faz: forçar
  // a Pluggy a resincronizar com o banco — o Meu Pluggy dele é quem faz isso,
  // e a API rejeita pedido de sync forçado nesse tipo de conector
  // (confirmado testando: "MeuPluggy item cant be updated"). Então isso
  // mostra o que a Pluggy já tem sincronizado, não força sincronizar agora.
  function refreshAll() {
    setRefreshing(true)
    window.location.reload()
  }

  return (
    <div className={styles.shell}>
      {/* Desktop: sidebar. Some items also power the mobile bottom nav below. */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <img src="/favicon.svg" alt="" width={22} height={22} />
          Command OS
        </div>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `${styles.sidebarItem} ${isActive ? styles.sidebarItemActive : ''}`}
          >
            <Icon size={18} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.greeting}>
            <span className={styles.hello}>{greeting()}</span>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.iconBtn} onClick={refreshAll} disabled={refreshing} aria-label="Atualizar dados">
              <RefreshCw size={14} strokeWidth={2} className={refreshing ? styles.spinning : ''} />
            </button>
            <button className={styles.iconBtn} aria-label="Buscar transação">
              <Search size={14} strokeWidth={2} />
            </button>
            <button className={styles.iconBtn} aria-label="Notificações">
              <Bell size={14} strokeWidth={2} />
            </button>
          </div>
        </header>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      {/* Mobile: bottom tab bar (hidden on desktop via CSS) */}
      <nav className={styles.bottomNav}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
          >
            <Icon size={18} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
