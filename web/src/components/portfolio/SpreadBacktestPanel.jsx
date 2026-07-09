import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, createSeriesMarkers, LineSeries } from 'lightweight-charts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api'
import { getChartColors } from '@/lib/chartColors'
import { ALL_TENOR_OPTIONS } from '@/lib/rateHistory'
import { fmt } from '@/lib/format'
import { useTradeDetail } from '@/lib/useTradeDetail'
import { TradeDetailPanel } from './TradeDetailPanel'

// A backtest run always re-hits the API with the current params -- there is
// no client-side recomputation of the strategy anywhere in this file. Every
// number the charts/table show below comes straight from the response.

const DEFAULT_PARAMS = {
  short: '1Y',
  long: '3Y',
  lookback: '60',
  entry_z: '2.0',
  exit_z: '0.5',
  stop_z: '3.5',
  cost_bp: '0.05',
  notional: '1000000',
}

function fieldLabelClass() {
  return 'text-[11px] uppercase tracking-wide text-muted-foreground'
}

function TenorSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:border-primary"
    >
      {ALL_TENOR_OPTIONS.map((opt) => (
        <option key={opt.key} value={opt.key}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

// One synced pane -- owns its own chart lifecycle (create/resize/theme); the
// series itself is created/updated by the caller's own effect via
// onChartReady, mirroring OverviewPage.jsx's ChartPane. Every onChartReady
// call is treated as a fresh start (not just the first) because React
// StrictMode double-invokes mount effects in dev, which previously caused a
// stale-series crash elsewhere in this app when refs weren't reset the same
// way on every call (see OverviewPage.jsx's handle*ChartReady comments).
function ChartPane({ height, onChartReady }) {
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
    </div>
  )
}

function syncRange(source, target, syncingRef) {
  source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncingRef.current || range == null) return
    syncingRef.current = true
    target.timeScale().setVisibleLogicalRange(range)
    syncingRef.current = false
  })
}

export function SpreadBacktestPanel({ startDate, endDate, dateRange }) {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Stabilized so `openTrade`'s own useCallback identity (deps on this
  // object) doesn't churn every render -- without this, a *new*
  // backtestParams object was constructed inline on every render, which
  // defeated useTradeDetail's memoization for no reason other than object
  // identity. latestAvailableDate is the true max market-data date (not the
  // possibly-earlier `endDate` the user has the top-level chart window
  // scrolled to) -- draft what-if trades trace all the way to it.
  const backtestParams = useMemo(
    () => ({
      long: params.long,
      short: params.short,
      notional: Number(params.notional) || 0,
      latestAvailableDate: dateRange?.max ?? null,
    }),
    [params.long, params.short, params.notional, dateRange?.max],
  )
  const detail = useTradeDetail(backtestParams)

  // Read by the spread chart's click handler, which is wired once at chart
  // mount time (see handleSpreadChartReady) and needs the latest trades list
  // / latest `detail` without re-subscribing on every `result` update.
  // ChartPane's creation effect has `[]` deps, so subscribeClick's callback
  // is registered exactly once and would otherwise permanently close over
  // whatever `detail` (and therefore whatever stale backtestParams) existed
  // at that first mount -- these refs are the fix: always dereferenced at
  // click-time, never captured.
  const resultRef = useRef(null)
  useEffect(() => {
    resultRef.current = result
  }, [result])

  const detailRef = useRef(detail)
  useEffect(() => {
    detailRef.current = detail
  }, [detail])

  // What-If simulator: a click on any of the three synced charts opens the
  // detail panel for that date, whether or not a backtest trade happened to
  // land there. An exact-date match against the current backtest's trades
  // still opens the REAL trade (preserving entry/exit/pnl inspection); any
  // other date becomes a synthetic draft the trader can freely reprice.
  function resolveTradeForClick(clickedDate) {
    const trades = resultRef.current?.trades ?? []
    const matched = trades.find((t) => t.entry_date === clickedDate || t.exit_date === clickedDate)
    if (matched) return matched
    return {
      entry_date: clickedDate,
      exit_date: null,
      direction: null,
      pnl: null,
      exit_reason: null,
      is_draft: true,
    }
  }

  // Shared by all three synced charts (spread/z-score/equity) -- lightweight-charts
  // resolves param.time to the nearest plotted bar for any click inside the
  // data range, marker or not; a click outside the plotted range (empty
  // margin, price-scale gutter) leaves param.time undefined and is ignored.
  function handleChartClick(param) {
    if (!param.time) return
    detailRef.current.openTrade(resolveTradeForClick(param.time))
  }

  const entryZ = Number(params.entry_z)
  const exitZ = Number(params.exit_z)
  const stopZ = Number(params.stop_z)
  const thresholdError =
    Number.isFinite(entryZ) && Number.isFinite(exitZ) && entryZ <= exitZ
      ? 'entry_z는 exit_z보다 커야 합니다.'
      : Number.isFinite(stopZ) && Number.isFinite(entryZ) && stopZ <= entryZ
        ? 'stop_z는 entry_z보다 커야 합니다.'
        : ''

  function setParam(key, value) {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  function runBacktest() {
    if (!startDate || !endDate || thresholdError) return
    setLoading(true)
    setError('')
    const qs = new URLSearchParams({
      start: startDate,
      end: endDate,
      short: params.short,
      long: params.long,
      lookback: params.lookback,
      entry_z: params.entry_z,
      exit_z: params.exit_z,
      stop_z: params.stop_z,
      cost_bp: params.cost_bp,
      notional: params.notional,
    })
    apiGet(`/api/spread-backtest?${qs.toString()}`)
      .then((data) => setResult(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  // Run once with the defaults as soon as a date range is available.
  const ranOnceRef = useRef(false)
  useEffect(() => {
    if (ranOnceRef.current || !startDate || !endDate) return
    ranOnceRef.current = true
    runBacktest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate])

  const spreadChartRef = useRef(null)
  const zscoreChartRef = useRef(null)
  const equityChartRef = useRef(null)
  const spreadSeriesRef = useRef(null)
  const spreadMarkersRef = useRef(null)
  const zscoreSeriesRef = useRef(null)
  const zscorePriceLinesRef = useRef([])
  const equitySeriesRef = useRef(null)
  const syncingRef = useRef(false)

  function wireCharts() {
    const charts = [spreadChartRef.current, zscoreChartRef.current, equityChartRef.current]
    if (charts.some((c) => !c)) return
    for (let i = 0; i < charts.length; i++) {
      for (let j = 0; j < charts.length; j++) {
        if (i !== j) syncRange(charts[i], charts[j], syncingRef)
      }
    }
  }

  function handleSpreadChartReady(chart) {
    spreadChartRef.current = chart
    spreadSeriesRef.current = null
    spreadMarkersRef.current = null
    wireCharts()
    chart.subscribeClick(handleChartClick)
  }
  function handleZscoreChartReady(chart) {
    zscoreChartRef.current = chart
    zscoreSeriesRef.current = null
    zscorePriceLinesRef.current = []
    wireCharts()
    chart.subscribeClick(handleChartClick)
  }
  function handleEquityChartReady(chart) {
    equityChartRef.current = chart
    equitySeriesRef.current = null
    wireCharts()
    chart.subscribeClick(handleChartClick)
  }

  // Spread chart + entry/exit markers.
  useEffect(() => {
    const chart = spreadChartRef.current
    if (!chart || !result) return
    const colors = getChartColors(document.documentElement.classList.contains('dark'))

    if (!spreadSeriesRef.current) {
      spreadSeriesRef.current = chart.addSeries(LineSeries, { color: colors.lineColor, lineWidth: 2, title: '스프레드 (bp)' })
    }
    spreadSeriesRef.current.setData(result.points.map((p) => ({ time: p.valuation_date, value: p.spread_bp })))

    if (!spreadMarkersRef.current) {
      spreadMarkersRef.current = createSeriesMarkers(spreadSeriesRef.current, [])
    }
    spreadMarkersRef.current.setMarkers(
      result.trades.flatMap((t) => [
        {
          time: t.entry_date,
          position: t.direction === -1 ? 'aboveBar' : 'belowBar',
          color: '#d97706',
          shape: t.direction === -1 ? 'arrowDown' : 'arrowUp',
          text: '진입',
        },
        {
          time: t.exit_date,
          position: 'inBar',
          color: t.pnl > 0 ? '#16a34a' : '#dc2626',
          shape: 'circle',
          text: t.exit_reason === 'stop' ? '손절' : '청산',
        },
      ]),
    )

    chart.timeScale().fitContent()
  }, [result])

  // Z-score chart + entry/exit/stop threshold lines.
  useEffect(() => {
    const chart = zscoreChartRef.current
    if (!chart || !result) return
    const colors = getChartColors(document.documentElement.classList.contains('dark'))

    if (!zscoreSeriesRef.current) {
      zscoreSeriesRef.current = chart.addSeries(LineSeries, { color: colors.lineColor, lineWidth: 2, title: 'Z-score' })
    }
    zscoreSeriesRef.current.setData(
      result.points.filter((p) => p.z_score != null).map((p) => ({ time: p.valuation_date, value: p.z_score })),
    )

    for (const line of zscorePriceLinesRef.current) {
      zscoreSeriesRef.current.removePriceLine(line)
    }
    const { entry_z, exit_z, stop_z } = result
    zscorePriceLinesRef.current = [
      [entry_z, '#d97706', '진입'],
      [-entry_z, '#d97706', '진입'],
      [exit_z, '#6b7280', '청산'],
      [-exit_z, '#6b7280', '청산'],
      [stop_z, '#dc2626', '손절'],
      [-stop_z, '#dc2626', '손절'],
    ].map(([price, color, title]) =>
      zscoreSeriesRef.current.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }),
    )

    chart.timeScale().fitContent()
  }, [result])

  // Equity (cumulative P&L) chart.
  useEffect(() => {
    const chart = equityChartRef.current
    if (!chart || !result) return
    const colors = getChartColors(document.documentElement.classList.contains('dark'))

    if (!equitySeriesRef.current) {
      equitySeriesRef.current = chart.addSeries(LineSeries, { color: colors.lineColor, lineWidth: 2, title: '누적 손익' })
    }
    equitySeriesRef.current.setData(result.points.map((p) => ({ time: p.valuation_date, value: p.cumulative_pnl })))

    chart.timeScale().fitContent()
  }, [result])

  const summary = result?.summary

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Spread 평균회귀 백테스트</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Short</Label>
            <TenorSelect value={params.short} onChange={(v) => setParam('short', v)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Long</Label>
            <TenorSelect value={params.long} onChange={(v) => setParam('long', v)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Lookback (일)</Label>
            <Input type="number" min="2" value={params.lookback} onChange={(e) => setParam('lookback', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Entry Z</Label>
            <Input type="number" step="0.1" value={params.entry_z} onChange={(e) => setParam('entry_z', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Exit Z</Label>
            <Input type="number" step="0.1" value={params.exit_z} onChange={(e) => setParam('exit_z', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Stop Z</Label>
            <Input type="number" step="0.1" value={params.stop_z} onChange={(e) => setParam('stop_z', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Cost (bp, 편도)</Label>
            <Input type="number" step="0.01" value={params.cost_bp} onChange={(e) => setParam('cost_bp', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className={fieldLabelClass()}>Notional (원/bp)</Label>
            <NumberInput value={params.notional} onChange={(e) => setParam('notional', e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runBacktest}
            disabled={loading || !!thresholdError || !startDate || !endDate}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors',
              'bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            백테스트 실행
          </button>
          <span className="text-xs text-muted-foreground">
            기간: {startDate || dateRange?.min} ~ {endDate || dateRange?.max} (상단 날짜 선택과 동일)
          </span>
          {loading && <span className="text-xs text-muted-foreground">실행 중…</span>}
        </div>
        {thresholdError && <p className="text-xs text-destructive">{thresholdError}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Total P&amp;L</div>
              <div className={cn('font-semibold', summary.total_pnl >= 0 ? 'text-positive' : 'text-negative')}>
                {fmt(summary.total_pnl)}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Max Drawdown</div>
              <div className="font-semibold">{fmt(summary.max_drawdown)}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Win Rate</div>
              <div className="font-semibold">{summary.win_rate != null ? `${(summary.win_rate * 100).toFixed(1)}%` : '—'}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Sharpe</div>
              <div className="font-semibold">{summary.sharpe_ratio != null ? summary.sharpe_ratio.toFixed(2) : '—'}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-[11px] uppercase text-muted-foreground"># Trades</div>
              <div className="font-semibold">{summary.num_trades}</div>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Spread (bp) + 진입/청산</div>
          <ChartPane height={240} onChartReady={handleSpreadChartReady} />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Z-score</div>
          <ChartPane height={180} onChartReady={handleZscoreChartReady} />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">누적 손익</div>
          <ChartPane height={200} onChartReady={handleEquityChartReady} />
        </div>

        {result && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">거래 내역</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>진입일</TableHead>
                  <TableHead>청산일</TableHead>
                  <TableHead>방향</TableHead>
                  <TableHead>진입 Z</TableHead>
                  <TableHead>청산 Z</TableHead>
                  <TableHead>진입 Spread</TableHead>
                  <TableHead>청산 Spread</TableHead>
                  <TableHead>손익</TableHead>
                  <TableHead>사유</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.trades.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      거래 없음
                    </TableCell>
                  </TableRow>
                )}
                {result.trades.map((t, i) => (
                  <TableRow
                    key={i}
                    className={cn(
                      'cursor-pointer',
                      detail.selectedTrade === t && 'bg-accent/60',
                    )}
                    onClick={() => detail.openTrade(t)}
                  >
                    <TableCell>{t.entry_date}</TableCell>
                    <TableCell>{t.exit_date}</TableCell>
                    <TableCell>{t.direction === 1 ? 'Long' : 'Short'}</TableCell>
                    <TableCell>{t.entry_z.toFixed(2)}</TableCell>
                    <TableCell>{t.exit_z.toFixed(2)}</TableCell>
                    <TableCell>{t.entry_spread_bp.toFixed(2)}</TableCell>
                    <TableCell>{t.exit_spread_bp.toFixed(2)}</TableCell>
                    <TableCell className={t.pnl >= 0 ? 'text-positive' : 'text-negative'}>{fmt(t.pnl)}</TableCell>
                    <TableCell>{t.exit_reason === 'stop' ? '손절' : '청산'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
    <TradeDetailPanel detail={detail} />
    </>
  )
}
