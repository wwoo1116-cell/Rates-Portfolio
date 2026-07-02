// Pure data-transform utilities for the Historical PnL candlestick dashboard.
// No React/DOM dependency -- reasoned about and spot-checked independently of
// the charting library and React lifecycle.
//
// The backend gives exactly ONE net_npv value per business day (not real
// intraday OHLC). Candles here are synthesized from consecutive daily marks:
// a day's open is the PREVIOUS day's value and its close is its own value, so
// the candle body visualizes day-over-day change, not an intraday range.

function parseIsoDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toIsoDateStr(date) {
  return date.toISOString().slice(0, 10)
}

export function toDailyCandles(points) {
  if (!points || points.length === 0) return []
  return points.map((p, i) => {
    const open = i === 0 ? points[0].net_npv : points[i - 1].net_npv
    const close = p.net_npv
    return {
      time: p.valuation_date,
      open,
      close,
      high: Math.max(open, close),
      low: Math.min(open, close),
      delta: close - open,
    }
  })
}

function weekBucketKey(dateStr) {
  const date = parseIsoDate(dateStr)
  const day = date.getUTCDay() // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diffToMonday)
  return toIsoDateStr(date)
}

function monthBucketKey(dateStr) {
  const [y, m] = dateStr.split('-')
  return `${y}-${m}-01`
}

// granularity: 'day' | 'week' | 'month'. 'day' is an identity passthrough.
// Weekly/monthly bucket high/low are derived from the daily CLOSE values in
// the bucket (i.e. the actual net_npv marks), not from the synthetic daily
// open/high/low, so the flat first-day candle never inflates a bucket's range.
export function resampleCandles(dailyCandles, granularity) {
  if (granularity === 'day' || dailyCandles.length === 0) return dailyCandles

  const keyFn = granularity === 'week' ? weekBucketKey : monthBucketKey
  const buckets = new Map()

  for (const candle of dailyCandles) {
    const key = keyFn(candle.time)
    if (!buckets.has(key)) {
      buckets.set(key, { time: key, open: candle.open, close: candle.close, high: candle.close, low: candle.close })
    }
    const bucket = buckets.get(key)
    bucket.close = candle.close
    bucket.high = Math.max(bucket.high, candle.close)
    bucket.low = Math.min(bucket.low, candle.close)
  }

  return Array.from(buckets.values())
    .map((bucket) => ({ ...bucket, delta: bucket.close - bucket.open }))
    .sort((a, b) => (a.time < b.time ? -1 : 1))
}
