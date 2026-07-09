// Helpers for mapping a UI tenor label (e.g. from ALL_TENOR_OPTIONS) onto a
// MarketDataResponse's swap_quotes[] entries, and onto this engine's
// whole-year-only VanillaSwap.tenor_years.

// Mirrors engine/curve.py's _quote_label() so a label picked in the UI can
// be matched back to the swap_quotes[] entry it came from.
export function quoteLabel(q) {
  if (q.tenor_months == null) return `${q.tenor_years}Y`
  const months = q.tenor_months
  if (months < 12) return `${months}M`
  if (months % 12 === 0) return `${months / 12}Y`
  return `${+(months / 12).toFixed(2)}Y`
}

export function findQuoteRate(swapQuotes, tenorLabel) {
  const match = swapQuotes?.find((q) => quoteLabel(q) === tenorLabel)
  return match?.rate ?? null
}

// Whole-year approximation for VanillaSwap.tenor_years -- this engine's
// booked-swap model has no sub-annual tenor, so '6M'/'9M' round up to 1Y,
// '1.5Y' rounds to 2Y, etc. Always user-editable in the spec form afterward.
export function approxTenorYears(tenorLabel) {
  if (tenorLabel === 'cd_rate') return 1
  const n = parseFloat(tenorLabel)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.round(n))
}
