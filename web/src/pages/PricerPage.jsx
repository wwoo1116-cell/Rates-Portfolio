import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ParRateTable } from '@/components/ParRateTable'
import { SwapForm } from '@/components/SwapForm'
import { ResultCard } from '@/components/ResultCard'
import { apiGet } from '@/lib/api'

const LIVE_POLL_MS = 10_000

function PricerPage() {
  const [dateRange, setDateRange] = useState({ min: '', max: '' })
  const [valuationDate, setValuationDate] = useState('')
  const [cdRate, setCdRate] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [marketDataLoading, setMarketDataLoading] = useState(false)
  const [marketDataError, setMarketDataError] = useState('')
  const [result, setResult] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    async function loadRange() {
      try {
        const body = await apiGet('/api/market-data/range')
        setDateRange({ min: body.min_date, max: body.max_date })
        setValuationDate(body.max_date)
      } catch (err) {
        setMarketDataError(err.message)
      }
    }
    loadRange()
  }, [])

  // silent=true is used for background polling: it refreshes rates without
  // flipping the loading spinner or clearing the result the user is viewing.
  const loadMarketData = useCallback(async (targetDate, { silent = false } = {}) => {
    if (!targetDate) return
    if (!silent) {
      setMarketDataLoading(true)
      setMarketDataError('')
      setResult(null)
    }
    try {
      const body = await apiGet(`/api/market-data/${targetDate}`)
      setCdRate(body.cd_rate)
      setQuotes(
        body.swap_quotes
          .slice()
          .sort((a, b) => a.tenor_years - b.tenor_years)
          .map((q) => ({ tenor: `${q.tenor_years}Y`, rate: q.rate })),
      )
      setLastUpdated(new Date())
      if (silent) setMarketDataError('')
    } catch (err) {
      if (!silent) {
        setMarketDataError(err.message)
        setCdRate(null)
        setQuotes([])
      }
    } finally {
      if (!silent) setMarketDataLoading(false)
    }
  }, [])

  // Full (non-silent) load whenever the user picks a new date.
  useEffect(() => {
    loadMarketData(valuationDate)
  }, [valuationDate, loadMarketData])

  // Background polling: only for the latest available date, since that's the
  // one the xlwings updater (data_updater.py) can still be pushing live RTD into.
  const isLiveDate = Boolean(valuationDate) && valuationDate === dateRange.max
  useEffect(() => {
    if (!isLiveDate) return
    const id = setInterval(() => loadMarketData(valuationDate, { silent: true }), LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [isLiveDate, valuationDate, loadMarketData])

  const marketBlocked = marketDataLoading || Boolean(marketDataError)

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="bg-primary text-primary-foreground px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary-foreground/70">
            IRS Pricer
          </span>
          <span className="text-primary-foreground/30 text-xs">|</span>
          <span className="text-xs text-primary-foreground/70">원화 금리스왑(IRS) NPV 계산기</span>
          {isLiveDate && !marketDataError && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-3">
          <Link
            to="/methodology"
            className="text-xs text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-2"
          >
            산출 방식
          </Link>
          <Link
            to="/curve-comparison"
            className="text-xs text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-2"
          >
            보간법 비교
          </Link>
          {marketDataError && (
            <span className="text-xs text-red-300">{marketDataError}</span>
          )}
          {marketDataLoading && (
            <span className="text-xs text-primary-foreground/50">불러오는 중…</span>
          )}
          {!marketDataLoading && lastUpdated && (
            <span className="text-[11px] text-primary-foreground/40">
              {lastUpdated.toLocaleTimeString('en-GB')}
            </span>
          )}
          <input
            type="date"
            value={valuationDate}
            min={dateRange.min}
            max={dateRange.max}
            onChange={(e) => setValuationDate(e.target.value)}
            className="bg-primary/80 border border-primary-foreground/20 text-primary-foreground text-xs rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary-foreground/50 [color-scheme:dark]"
          />
        </div>
      </header>

      {/* Main two-column layout */}
      <main className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-[280px_1fr] gap-5 items-start">
        <div>
          <ParRateTable cdRate={cdRate} quotes={quotes} />
        </div>

        <div className="space-y-4">
          <SwapForm
            valuationDate={valuationDate}
            quotes={quotes}
            cdRate={cdRate}
            disabled={marketBlocked}
            onResult={setResult}
          />
          <ResultCard result={result} />
        </div>
      </main>
    </div>
  )
}

export default PricerPage
