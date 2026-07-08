// Shared constants/helpers for the Overview RV dashboard -- kept out of the
// component so OverviewPage.jsx stays focused on chart wiring.

// 'cd_rate' is handled specially (it's its own top-level response field, the
// curve's 3M/CD91D short end) -- everything else is a key into tenor_rates.
export const RATE_SERIES_OPTIONS = [
  { key: 'cd_rate', label: 'CD 91D (3M)' },
  { key: '6M', label: '6M' },
  { key: '1Y', label: '1Y' },
  { key: '2Y', label: '2Y' },
  { key: '3Y', label: '3Y' },
  { key: '5Y', label: '5Y' },
  { key: '10Y', label: '10Y' },
]

// Every tenor label True Data.xlsx can carry (mirrors infomax_schema.py's
// IRS_TENORS, via engine/curve.py's _quote_label), plus 'cd_rate' for the
// curve's short end -- the full choice set for the backtest's arbitrary
// short/long tenor-pair selectors (RATE_SERIES_OPTIONS above is deliberately
// a smaller curated subset for the always-on rate chart, not this).
export const ALL_TENOR_OPTIONS = [
  { key: 'cd_rate', label: 'CD 91D (3M)' },
  { key: '6M', label: '6M' },
  { key: '9M', label: '9M' },
  { key: '1Y', label: '1Y' },
  { key: '1.5Y', label: '1.5Y' },
  { key: '2Y', label: '2Y' },
  { key: '3Y', label: '3Y' },
  { key: '4Y', label: '4Y' },
  { key: '5Y', label: '5Y' },
  { key: '6Y', label: '6Y' },
  { key: '7Y', label: '7Y' },
  { key: '8Y', label: '8Y' },
  { key: '9Y', label: '9Y' },
  { key: '10Y', label: '10Y' },
  { key: '11Y', label: '11Y' },
  { key: '12Y', label: '12Y' },
  { key: '15Y', label: '15Y' },
  { key: '20Y', label: '20Y' },
  { key: '25Y', label: '25Y' },
  { key: '30Y', label: '30Y' },
]

// short/long tenor keys index into tenor_rates; spread = long - short, in bp.
export const SPREAD_DEFS = [
  { key: '1s3s', label: '1s3s', short: '1Y', long: '3Y' },
  { key: '2s5s', label: '2s5s', short: '2Y', long: '5Y' },
  { key: '3s10s', label: '3s10s', short: '3Y', long: '10Y' },
]

export function rateValue(point, seriesKey) {
  if (seriesKey === 'cd_rate') return point.cd_rate
  return point.tenor_rates?.[seriesKey] ?? null
}

// lightweight-charts LineSeries wants { time: 'YYYY-MM-DD', value }, sorted
// ascending, with no null values -- null points are dropped rather than
// passed through, since a missing day should just not exist on this line
// (not render as a break-to-zero).
export function toLineData(points, seriesKey) {
  return points
    .map((p) => ({ time: p.valuation_date, value: rateValue(p, seriesKey) }))
    .filter((d) => d.value != null && Number.isFinite(d.value))
}

export function toSpreadLineData(points, spreadDef) {
  return points
    .map((p) => {
      const shortRate = p.tenor_rates?.[spreadDef.short]
      const longRate = p.tenor_rates?.[spreadDef.long]
      if (shortRate == null || longRate == null) return null
      return { time: p.valuation_date, value: (longRate - shortRate) * 10000 } // bp
    })
    .filter(Boolean)
}

export function toBaseRateLineData(points) {
  return points
    .map((p) => ({ time: p.valuation_date, value: p.base_rate }))
    .filter((d) => d.value != null && Number.isFinite(d.value))
}
