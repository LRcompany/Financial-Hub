import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'
import { Dashboard } from './pages/Dashboard'
import { Orcamento } from './pages/Orcamento'
import { Patrimonio } from './pages/Patrimonio'
import { Projetos } from './pages/Projetos'
import { Settings } from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="orcamento" element={<Orcamento />} />
        <Route path="patrimonio" element={<Patrimonio />} />
        <Route path="projetos" element={<Projetos />} />
        <Route path="configuracoes" element={<Settings />} />
      </Route>
    </Routes>
  )
}
