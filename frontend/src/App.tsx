import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './layout/AppLayout'
import { Dashboard } from './pages/Dashboard'
import { Conexoes } from './pages/Conexoes'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="transacoes" element={<PlaceholderPage title="Transações" />} />
        <Route path="orcamento" element={<PlaceholderPage title="Orçamento" />} />
        <Route path="patrimonio" element={<PlaceholderPage title="Patrimônio" />} />
        <Route path="projetos" element={<PlaceholderPage title="Projetos" />} />
        <Route path="configuracoes" element={<Conexoes />} />
      </Route>
    </Routes>
  )
}
