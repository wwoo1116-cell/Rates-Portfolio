import { apiGet, apiPost } from '@/lib/api'

// Composes two EXISTING endpoints -- no new backend route needed for this
// feature. GET /api/market-data/{date} returns the raw quoted yields
// (cd_rate/on_rate/swap_quotes); POST /api/curve bootstraps that same
// snapshot into a discount-factor/zero-rate mesh, exactly like PricerPage
// already does for the current valuation date.
export async function fetchHistoricalSnapshot(date) {
  const marketData = await apiGet(`/api/market-data/${date}`)
  const curve = await apiPost('/api/curve', marketData)
  return { marketData, curve }
}
