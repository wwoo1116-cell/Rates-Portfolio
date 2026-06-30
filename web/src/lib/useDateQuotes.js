import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'

/**
 * Fetches and caches par-rate quotes for an arbitrary as-of date (e.g. a
 * historical trade_date, distinct from today's valuationDate), reusing
 * GET /api/market-data/{date} -- the same endpoint already used for the
 * live valuation-date quotes, so no second curve-build path is introduced.
 * Cached per date so repeated lookups for the same date (e.g. switching
 * tenor) never refetch. Pass an empty/null date to skip fetching.
 */
export function useDateQuotes(date) {
  const [cache, setCache] = useState({})

  useEffect(() => {
    if (!date || cache[date]) return
    let cancelled = false
    setCache((c) => ({ ...c, [date]: { status: 'loading' } }))
    apiGet(`/api/market-data/${date}`)
      .then((body) => {
        if (cancelled) return
        const quotes = body.swap_quotes.map((q) => ({ tenor: `${q.tenor_years}Y`, rate: q.rate }))
        setCache((c) => ({ ...c, [date]: { status: 'ok', quotes, cdRate: body.cd_rate } }))
      })
      .catch((err) => {
        if (cancelled) return
        setCache((c) => ({ ...c, [date]: { status: 'error', message: err.message } }))
      })
    return () => {
      cancelled = true
    }
  }, [date, cache])

  return cache[date] ?? null
}

export function parRatePctFromEntry(entry, tenor) {
  if (entry?.status !== 'ok') return null
  const q = entry.quotes.find((q) => q.tenor === tenor)
  return q ? (q.rate * 100).toFixed(4) : null
}
