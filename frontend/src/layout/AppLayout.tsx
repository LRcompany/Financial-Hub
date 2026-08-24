import { NavLink, Outlet } from 'react-router-dom'
import { Home, Receipt, Wallet, Briefcase, SlidersHorizontal, Search, Bell, Plus } from 'lucide-react'
import styles from './AppLayout.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/transacoes', label: 'Transações', icon: Receipt },
  { to: '/patrimonio', label: 'Patrimônio', icon: Wallet },
  { to: '/projetos', label: 'Projetos', icon: Briefcase },
  { to: '/configuracoes', label: 'Mais', icon: SlidersHorizontal },
]

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia, Luiz'
  if (hour < 18) return 'Boa tarde, Luiz'
  return 'Boa noite, Luiz'
}

export function AppLayout() {
  return (
    <div className={styles.shell}>
      {/* Desktop: sidebar. Some items also power the mobile bottom nav below. */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>Financial Hub</div>
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
            <span className={styles.title}>Financial Hub</span>
          </div>
          <div className={styles.headerActions}>
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

      <button className={styles.fab} aria-label="Novo lançamento">
        <Plus size={22} strokeWidth={2} />
      </button>

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
