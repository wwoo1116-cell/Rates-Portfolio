import { apiPost } from '@/lib/api'

// spec: { trade_date, tenor_years, notional, fixed_rate, pay_fixed, float_spread }
export function fetchNpvTrace(spec, startDate, endDate) {
  return apiPost('/api/mtm/npv-trace', {
    swap: spec,
    start_date: startDate,
    end_date: endDate,
  })
}
