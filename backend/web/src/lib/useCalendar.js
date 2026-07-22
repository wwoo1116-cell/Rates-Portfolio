import { useEffect, useSyncExternalStore } from 'react'
import { apiGet } from '@/lib/api'

// Quick-select tenors for the position date pickers. Sub-year and 1.5Y
// tenors are safe here (unlike SwapForm's 1Y-10Y pills, which drive
// /api/price's integer tenor_years curve lookup) because PositionRow always
// submits an explicit start_date/maturity_date pair to /api/portfolio/price,
// which prices off the interpolated curve for any date -- no tenor_years
// integer constraint applies.
export const TENOR_OPTIONS = [
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: '1.5Y', months: 18 },
  { label: '2Y', months: 24 },
  { label: '3Y', months: 36 },
  { label: '5Y', months: 60 },
  { label: '7Y', months: 84 },
  { label: '10Y', months: 120 },
]

/**
 * Shared, module-level caches (same pattern as useFairRate.js) so every
 * picker instance on the page reuses the same in-flight/completed requests
 * instead of re-fetching per row.
 */
const nonBusinessCache = new Map() // `${start}|${end}` -> {status, days: Set<string>} | {status:'error', message}
const tenorCache = new Map() // `${startDate}|${months}` -> {status, maturityDate} | {status:'error', message}
const tenorSnapshotCache = new Map() // startDate -> stable {months: date|null} object, invalidated on tenorCache update
const listeners = new Set()

const EMPTY_TENOR_SNAPSHOT = {}

function emit() {
  for (const l of listeners) l()
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function ensureNonBusinessDaysFetched(start, end) {
  const key = `${start}|${end}`
  const existing = nonBusinessCache.get(key)
  if (existing && existing.status !== 'error') return
  nonBusinessCache.set(key, { status: 'loading' })
  emit()
  apiGet(`/api/calendar/business-days?start=${start}&end=${end}`)
    .then((body) => {
      nonBusinessCache.set(key, { status: 'ok', days: new Set(body.non_business_days) })
      emit()
    })
    .catch((err) => {
      nonBusinessCache.set(key, { status: 'error', message: err.message })
      emit()
    })
}

// Returns {status: 'loading'|'ok'|'error', days, message} for the inclusive
// [start, end] range (both ISO date strings), or null if either is missing.
export function useNonBusinessDays(start, end) {
  const valid = Boolean(start && end && start <= end)
  useEffect(() => {
    if (valid) ensureNonBusinessDaysFetched(start, end)
  }, [start, end, valid])
  const key = `${start}|${end}`
  return useSyncExternalStore(subscribe, () => (valid ? (nonBusinessCache.get(key) ?? null) : null))
}

function ensureTenorDateFetched(startDate, months) {
  const key = `${startDate}|${months}`
  const existing = tenorCache.get(key)
  if (existing && existing.status !== 'error') return
  tenorCache.set(key, { status: 'loading' })
  tenorSnapshotCache.delete(startDate)
  emit()
  apiGet(`/api/calendar/tenor-date?start_date=${startDate}&months=${months}`)
    .then((body) => {
      tenorCache.set(key, { status: 'ok', maturityDate: body.maturity_date })
      tenorSnapshotCache.delete(startDate)
      emit()
    })
    .catch((err) => {
      tenorCache.set(key, { status: 'error', message: err.message })
      tenorSnapshotCache.delete(startDate)
      emit()
    })
}

function getTenorSnapshot(startDate) {
  if (!startDate) return EMPTY_TENOR_SNAPSHOT
  let snapshot = tenorSnapshotCache.get(startDate)
  if (!snapshot) {
    // Rebuilt only when invalidated above, so useSyncExternalStore sees a
    // stable reference across renders where nothing actually changed.
    snapshot = {}
    for (const { months } of TENOR_OPTIONS) {
      const entry = tenorCache.get(`${startDate}|${months}`)
      snapshot[months] = entry?.status === 'ok' ? entry.maturityDate : null
    }
    tenorSnapshotCache.set(startDate, snapshot)
  }
  return snapshot
}

// Batch-fetches the business-day-adjusted maturity date for every tenor in
// TENOR_OPTIONS given one start date. Returns {[months]: isoDateString|null}.
export function useTenorDates(startDate) {
  useEffect(() => {
    if (!startDate) return
    for (const { months } of TENOR_OPTIONS) ensureTenorDateFetched(startDate, months)
  }, [startDate])

  return useSyncExternalStore(subscribe, () => getTenorSnapshot(startDate))
}

const spotDateCache = new Map() // valuationDate -> {status, spotDate} | {status:'error', message}

function ensureSpotDateFetched(valuationDate) {
  const existing = spotDateCache.get(valuationDate)
  if (existing && existing.status !== 'error') return
  spotDateCache.set(valuationDate, { status: 'loading' })
  emit()
  apiGet(`/api/calendar/spot-date?valuation_date=${valuationDate}`)
    .then((body) => {
      spotDateCache.set(valuationDate, { status: 'ok', spotDate: body.spot_date })
      emit()
    })
    .catch((err) => {
      spotDateCache.set(valuationDate, { status: 'error', message: err.message })
      emit()
    })
}

// valuationDate + settlement lag -- the standard market convention start
// date for a brand-new spot-starting swap. Used to default a new position's
// 시작일, so a freshly-added row starts from the date the market actually
// quotes against, not today. See irs_pricer/services/calendar_service.py:
// spot_date.
export function useSpotDate(valuationDate) {
  useEffect(() => {
    if (valuationDate) ensureSpotDateFetched(valuationDate)
  }, [valuationDate])

  return useSyncExternalStore(subscribe, () => (valuationDate ? (spotDateCache.get(valuationDate) ?? null) : null))
}
