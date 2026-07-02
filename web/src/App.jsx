import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import PricerPage from './pages/PricerPage'
import PortfolioPage from './pages/PortfolioPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/pricer" replace />} />
        <Route path="/pricer" element={<PricerPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="*" element={<Navigate to="/pricer" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
