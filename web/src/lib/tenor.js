// Pure date/tenor helpers for the fixed-rate market hint (placeholder).
// Kept free of React and fetch so they can be unit-tested in isolation.

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

// Guards against transient garbage from <input type="date"> keyboard entry:
// typing "2" in the year segment briefly yields a valid-but-absurd date like
// "0002-01-15", which would otherwise trigger a market-data fetch.
export function isPlausibleMarketDate(dateStr) {
  if (!dateStr) return false
  const year = Number(dateStr.slice(0, 4))
  return Number.isInteger(year) && year >= 1990 && year <= 2100
}

// Average-year fraction between two ISO dates. Leap years are amortized via
// 365.25 -- both dates parse as UTC midnight so DST never enters; precision
// beyond that is unnecessary for a placeholder hint.
// Returns null unless both dates parse and maturity is strictly after start.
export function yearFraction(startDate, maturityDate) {
  if (!startDate || !maturityDate) return null
  const start = Date.parse(startDate)
  const end = Date.parse(maturityDate)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const years = (end - start) / MS_PER_YEAR
  return years > 0 ? years : null
}

// Linear interpolation on the quoted integer-year par curve. Quotes are
// [{tenor: '1Y'..'10Y', rate}] (order not assumed). Below the shortest quote
// the hint clamps to it (a 6M span still shows the 1Y rate); beyond the
// longest quote there is no defensible number, so null -> blank placeholder.
export function interpolateParRate(quotes, years) {
  if (!Array.isArray(quotes) || !Number.isFinite(years) || years <= 0) return null
  const points = quotes
    .map((q) => ({ years: parseInt(q.tenor, 10), rate: q.rate }))
    .filter((p) => Number.isFinite(p.years) && Number.isFinite(p.rate))
    .sort((a, b) => a.years - b.years)
  if (points.length === 0) return null
  if (years <= points[0].years) return points[0].rate
  if (years > points[points.length - 1].years) return null
  let lower = points[0]
  for (const p of points) {
    if (p.years >= years) {
      const w = (years - lower.years) / (p.years - lower.years)
      return lower.rate + w * (p.rate - lower.rate)
    }
    lower = p
  }
  return null
}
