// Simplified, frontend-only helper functions for the Methodology page demos.
// These intentionally do NOT call the FastAPI backend or QuantLib -- they exist
// to illustrate the *shape* of the logic, not to reproduce exact production
// numbers. See the disclaimer at the bottom of the Methodology page.

const DAY_MS = 86400000

export function addMonths(date, months) {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Build quarterly accrual periods between start and end (CD91's floating
 * tenor is 3M, so the demo schedule uses 3-month steps for both legs).
 */
export function buildQuarterlyPeriods(start, end) {
  const periods = []
  let cursor = new Date(start)
  let i = 0
  while (cursor < end) {
    const periodEnd = addMonths(cursor, 3)
    const accrualEnd = periodEnd < end ? periodEnd : new Date(end)
    periods.push({ index: i, start: new Date(cursor), end: accrualEnd })
    cursor = accrualEnd
    i += 1
  }
  return periods
}

/**
 * Classify a period relative to a valuation date, mirroring the Case A/B
 * split used by the real revaluation engine (mtm_valuation.py):
 *  - 'paid':    accrual_end <= valuation_date  -> already settled
 *  - 'current': accrual_start <= valuation_date < accrual_end -> rate was
 *               already fixed at accrual_start (CD91 resets in advance), so
 *               this period's cash flow is known even though it hasn't paid yet
 *  - 'future':  accrual_start > valuation_date -> rate not yet set, must be
 *               estimated from the forward curve
 */
export function classifyPeriod(period, valuationDate) {
  if (period.end <= valuationDate) return 'paid'
  if (period.start <= valuationDate && valuationDate < period.end) return 'current'
  return 'future'
}

// Shared illustrative market data for the bootstrapping/flat-forward demos
// (Sections 4 and 5). Not live data -- a fixed snapshot for pedagogy.
export const DEMO_CD_RATE = 0.0292
export const DEMO_PAR_RATES = { 1: 0.028, 2: 0.027, 3: 0.0265, 5: 0.026, 7: 0.0258, 10: 0.0257 }

// Tenor segments used by the bootstrapping demo. Quarters = number of 3M
// CD91 reset periods spanned by the segment.
export const BOOTSTRAP_SEGMENTS = [
  { label: '0–3M', fromYears: 0, toYears: 0.25, quarters: 1 },
  { label: '3M–1Y', fromYears: 0.25, toYears: 1, quarters: 3 },
  { label: '1Y–2Y', fromYears: 1, toYears: 2, quarters: 4 },
  { label: '2Y–3Y', fromYears: 2, toYears: 3, quarters: 4 },
  { label: '3Y–5Y', fromYears: 3, toYears: 5, quarters: 8 },
  { label: '5Y–7Y', fromYears: 5, toYears: 7, quarters: 8 },
  { label: '7Y–10Y', fromYears: 7, toYears: 10, quarters: 12 },
]

/**
 * Simplified sequential bootstrap: each segment's flat forward rate is solved
 * so that the equally-weighted average of all quarterly forwards from time 0
 * through that segment's end equals the par swap rate for that tenor. This
 * ignores discounting (a real bootstrap solves on a PV basis) but preserves
 * the *shape* of sequential bootstrapping -- shortest maturity outward, each
 * step only solving the newly-added segment given everything before it is
 * already fixed.
 */
export function buildBootstrapSteps(cdRate, parRates) {
  let cumQuarters = 0
  let cumSum = 0
  return BOOTSTRAP_SEGMENTS.map((seg, i) => {
    let rate
    let parRate = null
    if (i === 0) {
      rate = cdRate
    } else {
      parRate = parRates[seg.toYears]
      const totalQuarters = cumQuarters + seg.quarters
      rate = (parRate * totalQuarters - cumSum) / seg.quarters
    }
    cumSum += rate * seg.quarters
    cumQuarters += seg.quarters
    return { ...seg, index: i, rate, parRate }
  })
}
