// Pure date helper shared by the market-data-fetching hooks.
// Kept free of React and fetch so it can be unit-tested in isolation.

// Guards against transient garbage from <input type="date"> keyboard entry:
// typing "2" in the year segment briefly yields a valid-but-absurd date like
// "0002-01-15", which would otherwise trigger a market-data fetch.
export function isPlausibleMarketDate(dateStr) {
  if (!dateStr) return false
  const year = Number(dateStr.slice(0, 4))
  return Number.isInteger(year) && year >= 1990 && year <= 2100
}
