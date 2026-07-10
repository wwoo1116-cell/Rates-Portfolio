import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries, LineType } from 'lightweight-charts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { SpreadBacktestPanel } from '@/components/portfolio/SpreadBacktestPanel'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api'
import { getChartColors, seriesPalette, baseRateColor } from '@/lib/chartColors'
import {
  RATE_SERIES_OPTIONS,
  SPREAD_DEFS,
  toLineData,
  toSpreadLineData,
  toBaseRateLineData,
} from '@/lib/rateHistory'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 365

// Format a decimal rate (e.g. 0.0239) as a 4dp percentage string ("2.3900%").
// Used for Y-axis ticks, crosshair price labels, and series price labels on
// the Rates Overview chart -- applies globally so every series on that chart
// (BOK base rate + all IRS tenor lines) shares the same formatting rule.
const rateFormatter = (v) => `${(v * 100).toFixed(4)}%`

const DEFAULT_SERIES = new Set(['cd_rate', '1Y', '3Y', '10Y'])
const DEFAULT_SPREADS = new Set(['1s3s', '3s10s'])

function isoDaysAgo(fromIso, days) {
  const d = new Date(`${fromIso}T00:00:00Z`)
  d.setTime(d.getTime() - days * DAY_MS)
  return d.toISOString().slice(0, 10)
}

function toggleClass(active) {
  return cn(
    'px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors border',
    active
      ? 'bg-primary text-primary-foreground border-primary'
      : 'text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground',
  )
}

// One synced pane -- owns its own chart/series lifecycle; the parent only
// hands it `points`/selected keys and a ref-callback so the two panes can be
// cross-wired for crosshair + time-range sync after both exist.
function ChartPane({ height, onChartReady, formatter, children }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const colors = getChartColors(isDark)
    const chart = createChart(containerRef.current, {
      layout: { background: { color: colors.background }, textColor: colors.text },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
      // priceFormatter is passed in so the rates pane shows X.XXXX% while the
      // spreads pane (a separate ChartPane instance) keeps the default bp format.
      ...(formatter ? { localization: { priceFormatter: formatter } } : {}),
    })
    chartRef.current = chart
    onChartReady(chart)

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !chartRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      chartRef.current?.applyOptions({ width: entry.contentRect.width })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const colors = getChartColors(isDark)
    chart.applyOptions({
      layout: { background: { color: colors.background }, textColor: colors.text },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    })
  }, [isDark])

  return (
    <div style={{ height }} className="w-full">
      <div ref={containerRef} className="h-full w-full" />
      {children}
    </div>
  )
}

function OverviewPage() {
  const [dateRange, setDateRange] = useState({ min: '', max: '' })
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [selectedSeries, setSelectedSeries] = useState(DEFAULT_SERIES)
  const [selectedSpreads, setSelectedSpreads] = useState(DEFAULT_SPREADS)

  const ratesChartRef = useRef(null)
  const spreadsChartRef = useRef(null)
  const rateSeriesRef = useRef(new Map()) // key -> ISeriesApi, on the rates chart
  const spreadSeriesRef = useRef(new Map()) // key -> ISeriesApi, on the spreads chart
  const baseRateSeriesRef = useRef(null)
  const syncingRef = useRef(false)

  // Date range: default to the last 365 days of available data.
  useEffect(() => {
    apiGet('/api/market-data/range')
      .then((data) => {
        setDateRange({ min: data.min_date, max: data.max_date })
        setEndDate(data.max_date)
        setStartDate(isoDaysAgo(data.max_date, DEFAULT_WINDOW_DAYS) < data.min_date ? data.min_date : isoDaysAgo(data.max_date, DEFAULT_WINDOW_DAYS))
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    setError('')
    apiGet(`/api/rate-history?start=${startDate}&end=${endDate}`)
      .then((data) => setPoints(data.points))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [startDate, endDate])

  const hasBaseRate = useMemo(() => points.some((p) => p.base_rate != null), [points])

  // Each chart needs one of its OWN series to anchor the other chart's
  // mirrored crosshair on (an API requirement, not meaningful beyond that) --
  // filled in by whichever data effect below adds that chart's first series.
  const rateAnchorRef = useRef(null)
  const spreadAnchorRef = useRef(null)

  // React StrictMode (dev) double-invokes mount effects: ChartPane creates a
  // throwaway first chart, tears it down, then creates the real one. Without
  // resetting the bookkeeping here, rateAnchorRef/rateSeriesRef would keep
  // pointing at series that belong to the DISPOSED first chart -- any later
  // crosshair sync call (setCrosshairPosition) on that dead series throws
  // inside lightweight-charts with nothing to catch it. Treating every
  // onChartReady call as a fresh start (not just the first) makes this
  // correct regardless of how many times the effect fires.
  function handleRatesChartReady(chart) {
    ratesChartRef.current = chart
    rateSeriesRef.current = new Map()
    baseRateSeriesRef.current = null
    rateAnchorRef.current = null
    if (spreadsChartRef.current) wireBothCharts()
  }
  function handleSpreadsChartReady(chart) {
    spreadsChartRef.current = chart
    spreadSeriesRef.current = new Map()
    spreadAnchorRef.current = null
    if (ratesChartRef.current) wireBothCharts()
  }

  function wireBothCharts() {
    const rates = ratesChartRef.current
    const spreads = spreadsChartRef.current
    if (!rates || !spreads) return

    function syncRange(source, target) {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRef.current || range == null) return
        syncingRef.current = true
        target.timeScale().setVisibleLogicalRange(range)
        syncingRef.current = false
      })
    }
    syncRange(rates, spreads)
    syncRange(spreads, rates)

    // Wrapped defensively: the anchor is a series handle cached in a ref, so
    // an unforeseen disposal edge case (beyond the two already guarded
    // against above) would otherwise throw inside lightweight-charts with no
    // boundary to catch it -- better to silently skip one crosshair frame
    // than take down the whole page.
    function safeSetCrosshair(target, value, time, anchor) {
      try {
        target.setCrosshairPosition(value, time, anchor)
      } catch {
        try {
          target.clearCrosshairPosition()
        } catch {
          // target itself may be mid-teardown -- nothing more to do
        }
      }
    }

    rates.subscribeCrosshairMove((param) => {
      const anchor = spreadAnchorRef.current
      if (!anchor) return
      if (!param.time) {
        spreads.clearCrosshairPosition()
        return
      }
      const anyPoint = [...param.seriesData.values()][0]
      if (anyPoint?.value == null) {
        spreads.clearCrosshairPosition()
        return
      }
      safeSetCrosshair(spreads, anyPoint.value, param.time, anchor)
    })
    spreads.subscribeCrosshairMove((param) => {
      const anchor = rateAnchorRef.current
      if (!anchor) return
      if (!param.time) {
        rates.clearCrosshairPosition()
        return
      }
      const anyPoint = [...param.seriesData.values()][0]
      if (anyPoint?.value == null) {
        rates.clearCrosshairPosition()
        return
      }
      safeSetCrosshair(rates, anyPoint.value, param.time, anchor)
    })
  }

  // Rate lines: BOK base rate (step, distinct) + toggled tenors/CD91D.
  useEffect(() => {
    const chart = ratesChartRef.current
    if (!chart) return
    const isDark = document.documentElement.classList.contains('dark')
    const palette = seriesPalette(isDark)

    if (hasBaseRate) {
      if (!baseRateSeriesRef.current) {
        baseRateSeriesRef.current = chart.addSeries(LineSeries, {
          color: baseRateColor(isDark),
          lineWidth: 3,
          lineType: LineType.WithSteps,
          title: 'BOK 기준금리',
          priceFormat: { type: 'custom', formatter: rateFormatter },
        })
        rateAnchorRef.current = rateAnchorRef.current ?? baseRateSeriesRef.current
      }
      baseRateSeriesRef.current.setData(toBaseRateLineData(points))
    } else if (baseRateSeriesRef.current) {
      if (rateAnchorRef.current === baseRateSeriesRef.current) rateAnchorRef.current = null
      chart.removeSeries(baseRateSeriesRef.current)
      baseRateSeriesRef.current = null
    }

    const seriesMap = rateSeriesRef.current
    for (const [key, series] of seriesMap) {
      if (!selectedSeries.has(key)) {
        if (rateAnchorRef.current === series) rateAnchorRef.current = null
        chart.removeSeries(series)
        seriesMap.delete(key)
      }
    }
    RATE_SERIES_OPTIONS.forEach((opt, index) => {
      if (!selectedSeries.has(opt.key)) return
      let series = seriesMap.get(opt.key)
      if (!series) {
        series = chart.addSeries(LineSeries, { color: palette[index % palette.length], lineWidth: 2, title: opt.label, priceFormat: { type: 'custom', formatter: rateFormatter } })
        seriesMap.set(opt.key, series)
        rateAnchorRef.current = rateAnchorRef.current ?? series
      }
      series.setData(toLineData(points, opt.key))
    })

    chart.timeScale().fitContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selectedSeries, hasBaseRate])

  // Spread lines (bp).
  useEffect(() => {
    const chart = spreadsChartRef.current
    if (!chart) return
    const isDark = document.documentElement.classList.contains('dark')
    const palette = seriesPalette(isDark)

    const seriesMap = spreadSeriesRef.current
    for (const [key, series] of seriesMap) {
      if (!selectedSpreads.has(key)) {
        if (spreadAnchorRef.current === series) spreadAnchorRef.current = null
        chart.removeSeries(series)
        seriesMap.delete(key)
      }
    }
    SPREAD_DEFS.forEach((def, index) => {
      if (!selectedSpreads.has(def.key)) return
      let series = seriesMap.get(def.key)
      if (!series) {
        series = chart.addSeries(LineSeries, { color: palette[index % palette.length], lineWidth: 2, title: def.label })
        seriesMap.set(def.key, series)
        spreadAnchorRef.current = spreadAnchorRef.current ?? series
      }
      series.setData(toSpreadLineData(points, def))
    })

    chart.timeScale().fitContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selectedSpreads])

  function toggleSeries(key) {
    setSelectedSeries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function toggleSpread(key) {
    setSelectedSpreads((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 flex-wrap gap-3">
          <CardTitle>Rates Overview</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              min={dateRange.min}
              max={endDate || dateRange.max}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-border rounded-md px-2 py-1 bg-background"
            />
            <span className="text-muted-foreground">~</span>
            <input
              type="date"
              value={endDate}
              min={startDate || dateRange.min}
              max={dateRange.max}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-border rounded-md px-2 py-1 bg-background"
            />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-5">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {loading && <p className="text-xs text-muted-foreground">불러오는 중…</p>}

          <div className="flex flex-wrap gap-1.5">
            {RATE_SERIES_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={toggleClass(selectedSeries.has(opt.key))}
                onClick={() => toggleSeries(opt.key)}
              >
                {opt.label}
              </button>
            ))}
            {!hasBaseRate && (
              <span className="ml-2 self-center text-[11px] text-muted-foreground">
                (BOK 기준금리 데이터 없음 -- BOK Base Rate.xlsx 필요)
              </span>
            )}
          </div>

          <ChartPane height={340} onChartReady={handleRatesChartReady} formatter={rateFormatter} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>RV Spreads (bp)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {SPREAD_DEFS.map((def) => (
              <button
                key={def.key}
                type="button"
                className={toggleClass(selectedSpreads.has(def.key))}
                onClick={() => toggleSpread(def.key)}
              >
                {def.label}
              </button>
            ))}
          </div>

          <ChartPane height={240} onChartReady={handleSpreadsChartReady} />
        </CardContent>
      </Card>

      <SpreadBacktestPanel startDate={startDate} endDate={endDate} dateRange={dateRange} />
    </div>
  )
}

export default OverviewPage
