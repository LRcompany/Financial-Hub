import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'
import { Dashboard } from './pages/Dashboard'
import { Orcamento } from './pages/Orcamento'
import { Patrimonio } from './pages/Patrimonio'
import { Settings } from './pages/Settings'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="orcamento" element={<Orcamento />} />
        <Route path="patrimonio" element={<Patrimonio />} />
        <Route path="projetos" element={<PlaceholderPage title="Projetos" />} />
        <Route path="configuracoes" element={<Settings />} />
      </Route>
    </Routes>
  )
}
