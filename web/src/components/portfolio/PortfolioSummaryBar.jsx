import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmt, fmtEok } from '@/lib/format'

const STATS = [
  { key: 'net_npv', label: 'Net NPV' },
  { key: 'payer_npv', label: 'Payer NPV' },
  { key: 'receiver_npv', label: 'Receiver NPV' },
]

// Display-only tenor label (years, one decimal) -- cosmetic grouping for the
// breakdown list, not used anywhere in pricing.
function tenorLabel(startDate, maturityDate) {
  if (!startDate || !maturityDate) return '—'
  const ms = new Date(`${maturityDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)
  const years = ms / (365.25 * 24 * 60 * 60 * 1000)
  return Number.isFinite(years) && years > 0 ? `${years.toFixed(1)}Y` : '—'
}

function NpvBreakdown({ positions, result }) {
  if (!result || !positions?.length) return null

  const byId = new Map(result.position_results.map((pr) => [pr.position_id, pr]))
  const rows = positions
    .map((position) => ({ position, pr: byId.get(position.id) }))
    .filter((row) => row.pr)
    .sort((a, b) => Math.abs(b.pr.clean_npv) - Math.abs(a.pr.clean_npv))

  if (rows.length === 0) return null

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          NPV Breakdown · 영향도순
        </div>
        <ul className="divide-y divide-border">
          {rows.map(({ position, pr }) => {
            const positive = pr.clean_npv >= 0
            return (
              <li key={position.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs text-muted-foreground">
                  <Badge variant="outline">{position.direction === 'pay' ? '고정지급' : '고정수취'}</Badge>
                  <span>{tenorLabel(position.startDate, position.maturityDate)}</span>
                  <span>{fmt(Number(position.notional) || 0)} KRW</span>
                  <span>
                    @ {position.fixedRatePct !== '' ? Number(position.fixedRatePct).toFixed(4) : '—'}%
                  </span>
                </div>
                <span
                  className={cn(
                    'shrink-0 font-mono font-semibold tabular-nums text-sm',
                    positive ? 'text-positive' : 'text-negative',
                  )}
                >
                  {positive ? '+' : ''}
                  {fmt(pr.clean_npv)} KRW
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export function PortfolioSummaryBar({ result, positions }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STATS.map(({ key, label }) => {
          const value = result ? result[key] : null
          const positive = value != null && value >= 0

          return (
            <Card key={key}>
              <CardContent className="p-4 space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {label}
                </div>
                <div
                  className={cn(
                    'text-2xl font-bold font-mono tabular-nums',
                    value == null ? 'text-muted-foreground' : positive ? 'text-positive' : 'text-negative',
                  )}
                >
                  {value == null ? '—' : `${positive ? '+' : ''}${fmt(value)}`}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">KRW</span>
                </div>
                {value != null && <Badge variant={positive ? 'positive' : 'negative'}>{fmtEok(value)}</Badge>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <NpvBreakdown positions={positions} result={result} />
    </div>
  )
}
