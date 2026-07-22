import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/portfolio/Header'
import { PositionList } from '@/components/portfolio/PositionList'
import { PortfolioSummaryBar } from '@/components/portfolio/PortfolioSummaryBar'
import { HistoricalPnlPanel } from '@/components/portfolio/HistoricalPnlPanel'
import { LegacyImportBanner } from '@/components/portfolio/LegacyImportBanner'
import { PortfolioSidebar } from '@/components/portfolio/PortfolioSidebar'
import { RiskAnalyticsPanel } from '@/components/portfolio/RiskAnalyticsPanel'
import OverviewPage from '@/pages/OverviewPage'
import { MarketDataSourcePanel, createCcpCurveRows } from '@/components/portfolio/MarketDataSourcePanel'
import { apiGet, apiPost } from '@/lib/api'
import { buildPortfolioRequest } from '@/lib/portfolioRequest'
import { useSpotDate } from '@/lib/useCalendar'

// "3M" backs cd_rate and "1D" backs on_rate instead of being sent as
// swap_quotes: the engine's CD deposit helper is itself built on a 3-month
// period (FLOAT_LEG_TENOR), so a 3M swap_quote would land on the exact same
// curve pillar as cd_rate and QuantLib rejects the duplicate; "1D" is the
// O/N deposit pillar for the same reason.
const CCP_ON_RATE_TENOR = '1D'
const CCP_CD_RATE_TENOR = '3M'
const CCP_EXCLUDED_TENORS = new Set([CCP_ON_RATE_TENOR, CCP_CD_RATE_TENOR])

// "3M" -> 3, "1.5Y" -> 18, "10Y" -> 120. Every CCP row maps to a month count,
// which the backend now accepts as tenor_months (see RateQuoteIn) -- no
// tenor is left behind the way whole-year-only tenor_years used to.
function tenorLabelToMonths(label) {
  if (label.endsWith('Y')) return Math.round(parseFloat(label) * 12)
  if (label.endsWith('M')) return parseInt(label, 10)
  return null
}

const POSITIONS_STORAGE_KEY = 'irs-portfolio:positions'
const VALUATION_DATE_STORAGE_KEY = 'irs-portfolio:valuationDate'
const DATA_SOURCE_STORAGE_KEY = 'irs-portfolio:dataSource'
const CCP_CURVE_ROWS_STORAGE_KEY = 'irs-portfolio:ccpCurveRows'

// startDate defaults to '' when the spot date isn't resolved yet (e.g. the
// very first render); backfilled by the effect below as soon as it is.
function createPosition(startDate = '') {
  return {
    id: crypto.randomUUID(),
    startDate,
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

function loadStoredDataSource() {
  try {
    const raw = localStorage.getItem(DATA_SOURCE_STORAGE_KEY)
    return raw === 'ccp' || raw === 'true' ? raw : null
  } catch {
    return null
  }
}

// Only trusted if it's an array of the exact same tenors createCcpCurveRows()
// would produce right now, in the same order -- if CCP_TENORS ever changes,
// a stale saved row set falls back to fresh (empty) rows instead of silently
// mismatching tenor labels to the wrong rates.
function loadStoredCcpCurveRows() {
  try {
    const raw = localStorage.getItem(CCP_CURVE_ROWS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const fresh = createCcpCurveRows()
    if (!Array.isArray(parsed) || parsed.length !== fresh.length) return null
    if (!parsed.every((row, i) => row?.tenor === fresh[i].tenor)) return null
    return parsed
  } catch {
    return null
  }
}

function PortfolioPage() {
  const [dateRange, setDateRange] = useState({ min: '', max: '' })
  const [valuationDate, setValuationDate] = useState(loadStoredValuationDate)
  const [cdRate, setCdRate] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [marketDataError, setMarketDataError] = useState('')

  // 'true' = fetched market-data snapshot (existing behavior); 'ccp' = the
  // curve is typed in by hand below instead of fetched.
  const [dataSource, setDataSource] = useState(() => loadStoredDataSource() ?? 'true')
  const [ccpCurveRows, setCcpCurveRows] = useState(() => loadStoredCcpCurveRows() ?? createCcpCurveRows())

  function updateCcpRow(index, field, value) {
    setCcpCurveRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
    setResult(null)
  }

  function changeDataSource(value) {
    setDataSource(value)
    setResult(null)
  }

  // The single source of truth for "what market snapshot are we pricing
  // against right now" -- used for BOTH the reactive Par-rate hint (passed to
  // PositionList) and the actual /api/portfolio/price submission below, so
  // the two can never drift onto two different curves the way the hint and
  // the pricer once did for MTM re-evaluation (see mtm_service.fair_rate).
  // Returns {cdRate: null, quotes: []} (not "ready") until every CCP row has
  // a rate typed in.
  const effectiveMarket = useMemo(() => {
    // True Data doesn't carry an O/N rate yet -- onRate stays null there.
    if (dataSource !== 'ccp') return { cdRate, quotes, onRate: null }
    if (ccpCurveRows.some((row) => row.rate === '')) return { cdRate: null, quotes: [], onRate: null }
    const cdRow = ccpCurveRows.find((row) => row.tenor === CCP_CD_RATE_TENOR)
    const onRow = ccpCurveRows.find((row) => row.tenor === CCP_ON_RATE_TENOR)
    return {
      cdRate: Number(cdRow.rate) / 100,
      onRate: Number(onRow.rate) / 100,
      quotes: ccpCurveRows
        .filter((row) => !CCP_EXCLUDED_TENORS.has(row.tenor))
        .map((row) => {
          const months = tenorLabelToMonths(row.tenor)
          return { tenor_years: Math.max(1, Math.ceil(months / 12)), tenor_months: months, rate: Number(row.rate) / 100 }
        }),
    }
  }, [dataSource, cdRate, quotes, ccpCurveRows])

  // The backend's data_source literal ("true_data" | "ccp") -- decides
  // whether an already-reset floating period uses True Data's real
  // historical CD91D fixing or the CCP payload's own cd_rate (see
  // routers/portfolio.py:_resolve_fixings). Shared by the reactive Par-rate
  // hint (PositionList) and the /api/portfolio/price submission below, for
  // the same single-source-of-truth reason as effectiveMarket above.
  const apiDataSource = dataSource === 'ccp' ? 'ccp' : 'true_data'

  const [positions, setPositions] = useState(() => loadStoredPositions() ?? [createPosition()])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('portfolio')

  // Spot date (valuation_date + settlement lag) -- the market convention
  // start date for a brand-new swap. Defaults every new position's 시작일 to
  // this instead of leaving it blank, so the position is a real, priceable
  // spot-starting trade the moment it's created.
  const spotDateEntry = useSpotDate(valuationDate)
  const spotDate = spotDateEntry?.status === 'ok' ? spotDateEntry.spotDate : ''

  // Fills any position still missing a 시작일 (the initial default position
  // created before the spot date was known), AND re-syncs any position whose
  // 시작일 still equals the *previous* auto-assigned spot date -- valuationDate
  // resolves to today's default on mount before a user-picked value settles
  // in, so without this a position can get locked onto the wrong spot date
  // if the user changes valuationDate shortly after landing. A position the
  // user has actually repointed to some other date (not the last spot date)
  // is left alone -- only values that still match the prior auto-fill are
  // considered "still following today," never a deliberate historical pick.
  const prevSpotDateRef = useRef(null)
  useEffect(() => {
    if (!spotDate) return
    const prevSpotDate = prevSpotDateRef.current
    setPositions((prev) =>
      prev.map((p) => {
        if (!p.startDate || p.startDate === prevSpotDate) return { ...p, startDate: spotDate }
        return p
      }),
    )
    prevSpotDateRef.current = spotDate
  }, [spotDate])

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

  useEffect(() => {
    try {
      localStorage.setItem(DATA_SOURCE_STORAGE_KEY, dataSource)
    } catch {
      // ignore -- persistence is best-effort
    }
  }, [dataSource])

  useEffect(() => {
    try {
      localStorage.setItem(CCP_CURVE_ROWS_STORAGE_KEY, JSON.stringify(ccpCurveRows))
    } catch {
      // ignore -- persistence is best-effort
    }
  }, [ccpCurveRows])

  // Any edit invalidates the last computed result -- without this, a
  // position's row-level NPV (and the summary breakdown) would keep showing
  // a stale P&L number that no longer matches its current inputs.
  function updatePosition(id, field, value) {
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
    setResult(null)
  }

  function addPosition() {
    setPositions((prev) => [...prev, createPosition(spotDate)])
    setResult(null)
  }

  function removePosition(id) {
    setPositions((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev))
    setResult(null)
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

    if (dataSource === 'ccp' && ccpCurveRows.some((row) => row.rate === '')) {
      setError('CCP 할인곡선의 모든 만기에 금리를 입력해야 합니다.')
      return
    }

    setLoading(true)
    try {
      const data = await apiPost(
        '/api/portfolio/price',
        buildPortfolioRequest(positions, valuationDate, effectiveMarket, apiDataSource),
      )
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // CCP mode supplies its own curve by hand -- it never depends on the
  // fetched True Data snapshot, so a True Data outage shouldn't block it.
  const marketBlocked =
    dataSource === 'ccp' ? !valuationDate : !valuationDate || cdRate == null || Boolean(marketDataError)

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

        <main className="flex-1 min-w-0 space-y-6">
          {activeSection === 'overview' && <OverviewPage />}
          {activeSection === 'risk' && (
            <RiskAnalyticsPanel
              positions={positions}
              valuationDate={valuationDate}
              effectiveMarket={effectiveMarket}
              apiDataSource={apiDataSource}
              marketBlocked={marketBlocked}
            />
          )}
          {activeSection === 'portfolio' && (
            <>
              <LegacyImportBanner positions={positions} />

              <Card>
                <CardHeader>
                  <CardTitle>포지션 입력</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <MarketDataSourcePanel
                      dataSource={dataSource}
                      onDataSourceChange={changeDataSource}
                      ccpCurveRows={ccpCurveRows}
                      onCcpRowChange={updateCcpRow}
                    />

                    <Separator />

                    <PositionList
                      positions={positions}
                      onAdd={addPosition}
                      onUpdate={updatePosition}
                      onRemove={removePosition}
                      valuationDate={valuationDate}
                      cdRate={effectiveMarket.cdRate}
                      onRate={effectiveMarket.onRate}
                      quotes={effectiveMarket.quotes}
                      dataSource={apiDataSource}
                      result={result}
                    />

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    <Button type="submit" className="w-full" disabled={marketBlocked || loading}>
                      {loading ? '계산 중…' : '포트폴리오 계산'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <PortfolioSummaryBar result={result} positions={positions} />

              <HistoricalPnlPanel positions={positions} dateRange={dateRange} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default PortfolioPage
