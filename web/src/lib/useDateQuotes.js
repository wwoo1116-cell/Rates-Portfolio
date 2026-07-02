import { useEffect, useSyncExternalStore } from 'react'
import { apiGet } from '@/lib/api'
import { fmtRate4 } from '@/lib/format'
import { isPlausibleMarketDate } from '@/lib/tenor'

/**
 * Fetches and caches par-rate quotes for an arbitrary as-of date (e.g. a
 * historical trade_date, distinct from today's valuationDate), reusing
 * GET /api/market-data/{date} -- the same endpoint already used for the
 * live valuation-date quotes, so no second curve-build path is introduced.
 *
 * The cache is module-level and shared by every hook instance, so N
 * portfolio rows with the same start date issue a single request, and
 * results survive mount/unmount. Entries are keyed by date:
 *   {status: 'loading'} | {status: 'ok', quotes, cdRate} | {status: 'error', message}
 *
 * Implausible dates (transient <input type="date"> keyboard states like
 * "0002-01-15") are treated as absent and never fetched.
 */
const cache = new Map()
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureFetched(date) {
  const existing = cache.get(date)
  // 'error' entries are re-attempted on the next effect run (date re-selected
  // or another consumer mounts), so a transient backend failure isn't cached
  // forever. 'loading'/'ok' entries are never duplicated.
  if (existing && existing.status !== 'error') return
  cache.set(date, { status: 'loading' })
  emit()
  apiGet(`/api/market-data/${date}`)
    .then((body) => {
      const quotes = body.swap_quotes.map((q) => ({ tenor: `${q.tenor_years}Y`, rate: q.rate }))
      cache.set(date, { status: 'ok', quotes, cdRate: body.cd_rate })
      emit()
    })
    .catch((err) => {
      cache.set(date, { status: 'error', message: err.message })
      emit()
    })
}

export function useDateQuotes(date) {
  const valid = isPlausibleMarketDate(date)
  useEffect(() => {
    if (valid) ensureFetched(date)
  }, [date, valid])
  return useSyncExternalStore(subscribe, () => (valid ? (cache.get(date) ?? null) : null))
}

export function parRatePctFromEntry(entry, tenor) {
  if (entry?.status !== 'ok') return null
  const q = entry.quotes.find((q) => q.tenor === tenor)
  return q ? fmtRate4(q.rate) : null
}
