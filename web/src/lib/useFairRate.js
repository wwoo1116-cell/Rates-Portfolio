import { useEffect, useSyncExternalStore } from 'react'
import { apiGet, apiPost } from '@/lib/api'

// Fair rate is linear in notional (see engine/mtm_valuation.py:
// fair_rate_for_schedule -- pv_fixed_leg and pv_floating_leg both scale with
// notional, so it cancels out of the ratio). Any positive placeholder here
// yields the exact same rate as the position's real notional, which lets the
// hint be cached independent of notional edits.
const HINT_NOTIONAL = 100_000_000

const cache = new Map() // key -> {status:'loading'} | {status:'ok', fairRate} | {status:'error', message}
const listeners = new Set()

function emit() {
  for (const l of listeners) l()
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function keyFor(valuationDate, cdRate, quotes, startDate, maturityDate) {
  return JSON.stringify([valuationDate, cdRate, quotes, startDate, maturityDate])
}

function ensureFetched(key, valuationDate, cdRate, quotes, startDate, maturityDate) {
  const existing = cache.get(key)
  if (existing && existing.status !== 'error') return
  cache.set(key, { status: 'loading' })
  emit()
  apiPost('/api/portfolio/fair-rate', {
    valuation_date: valuationDate,
    cd_rate: Number(cdRate),
    swap_quotes: quotes,
    start_date: startDate,
    maturity_date: maturityDate,
    notional: HINT_NOTIONAL,
  })
    .then((body) => {
      cache.set(key, { status: 'ok', fairRate: body.fair_rate })
      emit()
    })
    .catch((err) => {
      cache.set(key, { status: 'error', message: err.message })
      emit()
    })
}

/**
 * The forward par rate for a position's exact start/maturity schedule,
 * priced off TODAY's valuation snapshot (the same valuationDate/cdRate/
 * quotes /api/portfolio/price will use) -- i.e. the rate at which this
 * position could be dealt right now, however far forward start_date is.
 * NOT a linear interpolation across the curve's raw quoted tenor rates,
 * which is only exact for a spot-starting, whole-tenor swap. See
 * irs_pricer/engine/mtm_valuation.py:fair_rate_for_schedule for why.
 *
 * Returns {status: 'loading'|'ok'|'error', fairRate, message} or null while
 * any required input is missing.
 */
export function usePositionFairRate(valuationDate, cdRate, quotes, startDate, maturityDate) {
  const ready = Boolean(
    valuationDate && cdRate != null && quotes?.length && startDate && maturityDate && startDate < maturityDate,
  )
  const key = ready ? keyFor(valuationDate, cdRate, quotes, startDate, maturityDate) : null

  useEffect(() => {
    if (ready) ensureFetched(key, valuationDate, cdRate, quotes, startDate, maturityDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already encodes every dependency
  }, [ready, key])

  return useSyncExternalStore(subscribe, () => (ready ? (cache.get(key) ?? null) : null))
}

const mtmCache = new Map() // key -> {status:'loading'} | {status:'ok', fairRate, maturityDate} | {status:'error', message}

function mtmKeyFor(valuationDate, cdRate, quotes, tradeDate, tenorYears) {
  return JSON.stringify([valuationDate, cdRate, quotes, tradeDate, tenorYears])
}

function ensureMtmFetched(key, valuationDate, cdRate, quotes, tradeDate, tenorYears) {
  const existing = mtmCache.get(key)
  if (existing && existing.status !== 'error') return
  mtmCache.set(key, { status: 'loading' })
  emit()
  apiPost('/api/mtm/fair-rate', {
    valuation_date: valuationDate,
    cd_rate: Number(cdRate),
    swap_quotes: quotes,
    trade_date: tradeDate,
    tenor_years: tenorYears,
    notional: HINT_NOTIONAL,
  })
    .then((body) => {
      mtmCache.set(key, { status: 'ok', fairRate: body.fair_rate, maturityDate: body.maturity_date })
      emit()
    })
    .catch((err) => {
      mtmCache.set(key, { status: 'error', message: err.message })
      emit()
    })
}

/**
 * The schedule-correct par rate for MTM re-evaluation of a booked trade --
 * priced off the exact same trade_date-literal schedule /api/mtm actually
 * prices (mtm_service.fair_rate(), reusing the identical _build_periods()
 * schedule value_booked_trade() uses). NOT the curve's raw quoted tenor
 * rate: that's the fair rate of a *different* swap, one effective on
 * settlement_date (trade_date + spot lag), which is why plugging it in used
 * to leave a nonzero NPV even when trade_date == valuation_date and the
 * curve hadn't moved.
 *
 * Returns {status: 'loading'|'ok'|'error', fairRate, maturityDate, message}
 * or null while any required input is missing.
 */
export function useMtmFairRate(valuationDate, cdRate, quotes, tradeDate, tenorYears) {
  const ready = Boolean(valuationDate && cdRate != null && quotes?.length && tradeDate && tenorYears)
  const key = ready ? mtmKeyFor(valuationDate, cdRate, quotes, tradeDate, tenorYears) : null

  useEffect(() => {
    if (ready) ensureMtmFetched(key, valuationDate, cdRate, quotes, tradeDate, tenorYears)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already encodes every dependency
  }, [ready, key])

  return useSyncExternalStore(subscribe, () => (ready ? (mtmCache.get(key) ?? null) : null))
}

/**
 * The historical spot par rate quoted ON startDate itself -- loads THAT
 * day's own market snapshot and prices off it, never today's curve. This is
 * a manual, one-shot lookup (not a reactive hook): historical trades must
 * NOT auto-fill from a forward-breakeven rate (that's a different question --
 * see useMtmFairRate/usePositionFairRate), so this is invoked imperatively
 * from a button click and the caller decides what to do with the result.
 *
 * Returns the raw historical_rate (decimal, e.g. 0.01895). Throws on error
 * (network failure, no data for that date, non-business-day) -- callers
 * should catch and surface err.message.
 */
export async function fetchHistoricalQuote(startDate, maturityDate, notional) {
  const params = new URLSearchParams({
    start_date: startDate,
    maturity_date: maturityDate,
    notional: String(notional),
  })
  const body = await apiGet(`/api/portfolio/historical-quote?${params}`)
  return body.historical_rate
}
