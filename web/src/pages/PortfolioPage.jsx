import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/portfolio/Header'
import { PositionList } from '@/components/portfolio/PositionList'
import { PortfolioSummaryBar } from '@/components/portfolio/PortfolioSummaryBar'
import { HistoricalPnlPanel } from '@/components/portfolio/HistoricalPnlPanel'
import { PortfolioSidebar } from '@/components/portfolio/PortfolioSidebar'
import { apiGet, apiPost } from '@/lib/api'

const POSITIONS_STORAGE_KEY = 'irs-portfolio:positions'
const VALUATION_DATE_STORAGE_KEY = 'irs-portfolio:valuationDate'

function ComingSoonSection({ title }) {
  return (
    <Card>
      <CardContent className="py-16 text-center text-sm text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">{title}</p>
        <p>준비 중입니다.</p>
      </CardContent>
    </Card>
  )
}

function createPosition() {
  return {
    id: crypto.randomUUID(),
    startDate: '',
    maturityDate: '',
    notional: '10000000000',
    fixedRatePct: '',
    direction: 'pay',
  }
}

function loadStoredPositions() {
  try {
    const raw = localStorage.getItem(POSITIONS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function loadStoredValuationDate() {
  try {
    return localStorage.getItem(VALUATION_DATE_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function PortfolioPage() {
  const [dateRange, setDateRange] = useState({ min: '', max: '' })
  const [valuationDate, setValuationDate] = useState(loadStoredValuationDate)
  const [cdRate, setCdRate] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [marketDataError, setMarketDataError] = useState('')

  const [positions, setPositions] = useState(() => loadStoredPositions() ?? [createPosition()])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('portfolio')

  useEffect(() => {
    async function loadRange() {
      try {
        const body = await apiGet('/api/market-data/range')
        setDateRange({ min: body.min_date, max: body.max_date })
        // Keep a previously persisted valuation date if we have one; only
        // default to the latest available date on a first-ever visit.
        setValuationDate((prev) => prev || body.max_date)
      } catch (err) {
        setMarketDataError(err.message)
      }
    }
    loadRange()
  }, [])

  useEffect(() => {
    if (!valuationDate) return
    async function loadSnapshot() {
      try {
        const body = await apiGet(`/api/market-data/${valuationDate}`)
        setCdRate(body.cd_rate)
        setQuotes(body.swap_quotes)
        setMarketDataError('')
      } catch (err) {
        setMarketDataError(err.message)
        setCdRate(null)
        setQuotes([])
      }
    }
    loadSnapshot()
  }, [valuationDate])

  // Persistence is best-effort: localStorage can throw (quota exceeded,
  // private-browsing restrictions), which should never break the UI.
  useEffect(() => {
    try {
      localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions))
    } catch {
      // ignore -- persistence is best-effort
    }
  }, [positions])

  useEffect(() => {
    if (!valuationDate) return
    try {
      localStorage.setItem(VALUATION_DATE_STORAGE_KEY, valuationDate)
    } catch {
      // ignore -- persistence is best-effort
    }
  }, [valuationDate])

  function updatePosition(id, field, value) {
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }

  function addPosition() {
    setPositions((prev) => [...prev, createPosition()])
  }

  function removePosition(id) {
    setPositions((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    for (const p of positions) {
      if (!p.startDate || !p.maturityDate) {
        setError('모든 포지션에 시작일과 만기일을 입력해야 합니다.')
        return
      }
      if (p.fixedRatePct === '') {
        setError('모든 포지션에 고정금리를 입력해야 합니다.')
        return
      }
    }

    setLoading(true)
    try {
      const data = await apiPost('/api/portfolio/price', {
        valuation_date: valuationDate,
        cd_rate: Number(cdRate),
        swap_quotes: quotes,
        positions: positions.map((p) => ({
          position_id: p.id,
          start_date: p.startDate,
          maturity_date: p.maturityDate,
          notional: Number(p.notional),
          fixed_rate: Number(p.fixedRatePct) / 100,
          pay_fixed: p.direction === 'pay',
        })),
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const marketBlocked = !valuationDate || cdRate == null || Boolean(marketDataError)

  return (
    <div className="min-h-screen bg-background">
      <Header
        valuationDate={valuationDate}
        dateRange={dateRange}
        onValuationDateChange={setValuationDate}
        marketDataError={marketDataError}
      />

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        <PortfolioSidebar active={activeSection} onChange={setActiveSection} />

        <main className="flex-1 min-w-0 space-y-5">
          {activeSection === 'overview' && <ComingSoonSection title="Overview" />}
          {activeSection === 'risk' && <ComingSoonSection title="Risk Analytics" />}
          {activeSection === 'portfolio' && (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <PositionList
                  positions={positions}
                  onAdd={addPosition}
                  onUpdate={updatePosition}
                  onRemove={removePosition}
                />

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button type="submit" className="w-full" disabled={marketBlocked || loading}>
                  {loading ? '계산 중…' : '포트폴리오 계산'}
                </Button>
              </form>

              <Separator />

              <PortfolioSummaryBar result={result} />

              <Separator />

              <HistoricalPnlPanel positions={positions} dateRange={dateRange} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default PortfolioPage
