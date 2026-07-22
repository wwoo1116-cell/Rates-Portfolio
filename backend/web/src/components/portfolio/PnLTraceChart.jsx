import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import { getChartColors, seriesPalette } from '@/lib/chartColors'

// Round to nearest 10,000 KRW and format with commas -- matches the app-wide
// display convention for KRW NPV/PnL values (see format.js: fmt(n, 0)).
const krwFormatter = (v) => {
  const rounded = Math.round(v / 10000) * 10000
  return rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// Dual-axis line chart: clean NPV on the left scale, cumulative PnL (vs
// entry-date NPV) on the right -- same ChartPane lifecycle conventions as
// SpreadBacktestPanel.jsx/OverviewPage.jsx (create-on-mount, ResizeObserver,
// MutationObserver for theme), just inlined here since this chart has two
// price scales instead of being one pane in a synced group.
export function PnLTraceChart({ trace, loading }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const npvSeriesRef = useRef(null)
  const pnlSeriesRef = useRef(null)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const colors = getChartColors(isDark)
    const chart = createChart(containerRef.current, {
      layout: { background: { color: colors.background }, textColor: colors.text },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: colors.border },
      leftPriceScale: { visible: true, borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    })
    chartRef.current = chart
    npvSeriesRef.current = null
    pnlSeriesRef.current = null

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) chart.applyOptions({ width: entry.contentRect.width })
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      npvSeriesRef.current = null
      pnlSeriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const colors = getChartColors(isDark)
    chart.applyOptions({
      layout: { background: { color: colors.background }, textColor: colors.text },
      rightPriceScale: { borderColor: colors.border },
      leftPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    })
  }, [isDark])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !trace) return
    const palette = seriesPalette(isDark)

    if (!npvSeriesRef.current) {
      npvSeriesRef.current = chart.addSeries(LineSeries, {
        color: palette[0],
        lineWidth: 2,
        title: 'Clean NPV',
        priceScaleId: 'left',
        priceFormat: { type: 'custom', formatter: krwFormatter },
      })
    }
    npvSeriesRef.current.setData(trace.points.map((p) => ({ time: p.valuation_date, value: p.clean_npv })))

    if (!pnlSeriesRef.current) {
      pnlSeriesRef.current = chart.addSeries(LineSeries, {
        color: palette[1],
        lineWidth: 2,
        title: '누적 손익',
        priceScaleId: 'right',
        priceFormat: { type: 'custom', formatter: krwFormatter },
      })
    }
    pnlSeriesRef.current.setData(trace.points.map((p) => ({ time: p.valuation_date, value: p.cumulative_pnl })))

    chart.timeScale().fitContent()
  }, [trace, isDark])

  return (
    <div style={{ height: 220 }} className="w-full">
      {loading && !trace && <div className="text-xs text-muted-foreground">계산 중…</div>}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
