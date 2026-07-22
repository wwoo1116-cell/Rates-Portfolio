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
    // Same Coinbase Blue as --primary/--chart-1, hardcoded here for the same
    // reason as --chart-bg/text/border above: canvas fillStyle needs a plain
    // hex the theme's OKLCH custom properties can't hand it directly.
    lineColor: isDark ? '#2d67e4' : '#0052ff',
    histUp: 'rgba(38, 166, 154, 0.5)',
    histDown: 'rgba(239, 83, 80, 0.5)',
  }
}

// Categorical palette for multi-series line charts (Overview rate/spread
// dashboard) -- plain hex for the same canvas-can't-read-OKLCH reason as
// above. Order roughly mirrors --chart-1..5's hues (blue, green, amber,
// red, gray) so the two systems read as related even though canvas can't
// consume the actual CSS custom properties.
const SERIES_PALETTE_LIGHT = ['#0052ff', '#16a34a', '#d97706', '#dc2626', '#6b7280', '#7c3aed']
const SERIES_PALETTE_DARK = ['#2d67e4', '#22c55e', '#f59e0b', '#ef4444', '#9ca3af', '#a78bfa']

export function seriesPalette(isDark) {
  return isDark ? SERIES_PALETTE_DARK : SERIES_PALETTE_LIGHT
}

// BOK base rate is a step function and deliberately rendered distinctly
// (thicker + its own color) from the market-rate lines around it.
export function baseRateColor(isDark) {
  return isDark ? '#e879f9' : '#a21caf'
}
