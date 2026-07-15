import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import PricerPage from './pages/PricerPage'
import PortfolioPage from './pages/PortfolioPage'
import OverviewPage from './pages/OverviewPage'
import SettingsPage from './pages/SettingsPage'
import SimulatorPage from './pages/SimulatorPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/pricer" replace />} />
        <Route path="/pricer" element={<PricerPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/simulator" element={<SimulatorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/pricer" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
