import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { cn } from '@/lib/utils'
import { fmtEok } from '@/lib/format'
import { getChartColors } from '@/lib/chartColors'
import { toDailyCandles, resampleCandles } from '@/lib/ohlcResample'

const GRANULARITIES = [
  { key: 'day', label: '1일' },
  { key: 'week', label: '1주' },
  { key: 'month', label: '1달' },
]

// lightweight-charts' crosshairMove callback returns `time` either as the
// original string (rare) or as a BusinessDay object {year, month, day}
// (typical for string-keyed daily/weekly/monthly series) -- normalize both to
// our 'YYYY-MM-DD' map key.
function timeToKey(time) {
  if (typeof time === 'string') return time
  if (time && typeof time === 'object' && 'year' in time) {
    return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
  }
  return null
}

function toggleButtonClass(active) {
  return cn(
    'px-3 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wide border transition-colors',
    active
      ? 'bg-primary text-primary-foreground border-primary'
      : 'bg-background text-foreground border-border hover:border-primary',
  )
}

export function HistoricalPnlDashboard({ points }) {
  const [granularity, setGranularity] = useState('month')
  const [chartType, setChartType] = useState('candlestick')
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  const containerRef = useRef(null)
  const tooltipRef = useRef(null)
  const chartRef = useRef(null)
  const priceSeriesRef = useRef(null)
  const priceSeriesTypeRef = useRef(null)
  const histSeriesRef = useRef(null)
  const candlesByTimeRef = useRef(new Map())

  // Mount: create the chart + histogram sub-pane + tooltip + theme observer.
  // The price series itself is owned by the data effect below (so there is a
  // single place that creates/recreates it, avoiding double-creation logic).
  useEffect(() => {
    const colors = getChartColors(isDark)
    const chart = createChart(containerRef.current, {
      layout: { background: { color: colors.background }, textColor: colors.text },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: { labelVisible: false },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
      localization: { priceFormatter: fmtEok },
    })
    chartRef.current = chart

    const histSeries = chart.addSeries(HistogramSeries, { priceScaleId: 'delta' })
    histSeries.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } })
    histSeriesRef.current = histSeries

    chart.subscribeCrosshairMove((param) => {
      const tooltipEl = tooltipRef.current
      const container = containerRef.current
      if (!tooltipEl || !container) return

      const candle = param.time ? candlesByTimeRef.current.get(timeToKey(param.time)) : null
      
      if (
        !candle || 
        !param.point || 
        param.point.x < 0 || 
        param.point.x > container.clientWidth || 
        param.point.y < 0 || 
        param.point.y > container.clientHeight
      ) {
        tooltipEl.style.display = 'none'
        return
      }

      tooltipEl.style.display = 'block'
      tooltipEl.innerHTML = `
        <div class="space-y-1.5">
          <div class="text-sm font-semibold mb-2 text-muted-foreground">${candle.time}</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
            <div class="text-muted-foreground">Open</div>
            <div class="text-right font-medium">${fmtEok(candle.open)}</div>
            <div class="text-muted-foreground">High</div>
            <div class="text-right font-medium">${fmtEok(candle.high)}</div>
            <div class="text-muted-foreground">Low</div>
            <div class="text-right font-medium">${fmtEok(candle.low)}</div>
            <div class="text-muted-foreground">Close</div>
            <div class="text-right font-medium">${fmtEok(candle.close)}</div>
          </div>
          <div class="mt-2 pt-2 border-t border-border flex justify-between text-sm font-semibold ${candle.delta >= 0 ? 'text-positive' : 'text-negative'}">
            <span>Delta</span>
            <span>${candle.delta >= 0 ? '+' : ''}${fmtEok(candle.delta)}</span>
          </div>
        </div>
      `

      const toolTipMargin = 15;
      const toolTipWidth = tooltipEl.offsetWidth || 160;
      const toolTipHeight = tooltipEl.offsetHeight || 160;

      let left = param.point.x + toolTipMargin;
      if (left > container.clientWidth - toolTipWidth) {
        left = param.point.x - toolTipMargin - toolTipWidth;
      }

      let top = param.point.y + toolTipMargin;
      if (top > container.clientHeight - toolTipHeight) {
        top = param.point.y - toolTipHeight - toolTipMargin;
      }

      tooltipEl.style.left = left + 'px'
      tooltipEl.style.top = top + 'px'
    })

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      priceSeriesRef.current = null
      priceSeriesTypeRef.current = null
      histSeriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Responsive resize: the container has a fixed CSS height, so only width
  // realistically changes, but pass both to stay correct if that changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !chartRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      chartRef.current?.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Data + chart-type: recompute candles, (re)create the price series only
  // when its type actually changed (v5 series are typed at creation), push
  // fresh data into both series.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const daily = toDailyCandles(points ?? [])
    const resampled = resampleCandles(daily, granularity)
    const colors = getChartColors(isDark)

    candlesByTimeRef.current = new Map(resampled.map((c) => [c.time, c]))

    if (!priceSeriesRef.current || priceSeriesTypeRef.current !== chartType) {
      if (priceSeriesRef.current) chart.removeSeries(priceSeriesRef.current)
      priceSeriesRef.current =
        chartType === 'candlestick'
          ? chart.addSeries(CandlestickSeries, {
              upColor: colors.upColor,
              downColor: colors.downColor,
              borderVisible: false,
              wickUpColor: colors.upColor,
              wickDownColor: colors.downColor,
            })
          : chart.addSeries(LineSeries, { color: colors.lineColor })
      priceSeriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } })
      priceSeriesTypeRef.current = chartType
    }

    priceSeriesRef.current.setData(
      chartType === 'candlestick'
        ? resampled.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
        : resampled.map((c) => ({ time: c.time, value: c.close })),
    )
    histSeriesRef.current?.setData(
      resampled.map((c) => ({ time: c.time, value: c.delta, color: c.delta >= 0 ? colors.histUp : colors.histDown })),
    )

    chart.timeScale().fitContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, granularity, chartType])

  // Theme: live-recolor the chart/series without a remount.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const colors = getChartColors(isDark)
    chart.applyOptions({
      layout: { background: { color: colors.background }, textColor: colors.text },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    })
    if (priceSeriesRef.current) {
      if (priceSeriesTypeRef.current === 'candlestick') {
        priceSeriesRef.current.applyOptions({
          upColor: colors.upColor,
          downColor: colors.downColor,
          wickUpColor: colors.upColor,
          wickDownColor: colors.downColor,
        })
      } else {
        priceSeriesRef.current.applyOptions({ color: colors.lineColor })
      }
    }
  }, [isDark])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          <button type="button" className={toggleButtonClass(chartType === 'candlestick')} onClick={() => setChartType('candlestick')}>
            캔들스틱
          </button>
          <button type="button" className={toggleButtonClass(chartType === 'line')} onClick={() => setChartType('line')}>
            꺾은선
          </button>
        </div>
        <div className="flex gap-2">
          {GRANULARITIES.map(({ key, label }) => (
            <button key={key} type="button" className={toggleButtonClass(granularity === key)} onClick={() => setGranularity(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-[360px] w-full">
        <div ref={containerRef} className="h-full w-full" />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-10 hidden rounded-md border border-border bg-background p-3 text-foreground shadow-md min-w-[160px]"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
