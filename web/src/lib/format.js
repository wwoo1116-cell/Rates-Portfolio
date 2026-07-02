// Shared number/currency formatters, lifted out of ResultCard.jsx so
// PortfolioSummaryBar/PortfolioCashFlowTable can reuse them without duplicating.

export function fmt(n, decimals = 0) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtPct(n) {
  if (n == null) return '—'
  return `${(Number(n) * 100).toFixed(4)}%`
}

// Secondary 억원 (100M KRW) display for summary-level figures only -- tables
// with many rows stay in raw KRW for readability.
export function fmtEok(n) {
  if (n == null) return null
  const eok = Number(n) / 100_000_000
  return `${eok.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}억원`
}

// Background-only sign indicator: soft/muted fill, never recolors text (stays
// text-foreground, which is near-black and passes WCAG AA on these pastels).
const PV_NEAR_ZERO = 1 // KRW
export function pvBg(value) {
  if (value == null || Math.abs(value) < PV_NEAR_ZERO) return 'bg-muted'
  return value > 0 ? 'bg-positive/10' : 'bg-negative/10'
}
