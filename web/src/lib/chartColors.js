// Resolves theme-aware colors for lightweight-charts, which renders to
// <canvas> and can't consume Tailwind classes or the app's OKLCH CSS
// variables directly -- reads the plain-hex --chart-* custom properties
// added in index.css instead, so the CSS is still the single source of
// truth for background/text/grid/border.
//
// Candle up/down colors are TradingView's own convention and deliberately
// NOT theme tokens -- they stay recognizable regardless of light/dark mode.

const UP_COLOR = '#26a69a'
const DOWN_COLOR = '#ef5350'

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function getChartColors(isDark) {
  return {
    background: cssVar('--chart-bg', isDark ? '#131722' : '#ffffff'),
    text: cssVar('--chart-text', isDark ? '#d1d4dc' : '#131722'),
    border: cssVar('--chart-border', isDark ? '#2a2e39' : '#d6d6d6'),
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    lineColor: isDark ? '#5b8def' : '#2962ff',
    histUp: 'rgba(38, 166, 154, 0.5)',
    histDown: 'rgba(239, 83, 80, 0.5)',
  }
}
