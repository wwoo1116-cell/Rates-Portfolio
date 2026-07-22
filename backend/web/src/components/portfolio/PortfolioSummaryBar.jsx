import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { fmt, fmtEok } from '@/lib/format'

const SECONDARY_STATS = [
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
    <div className="space-y-2">
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
    </div>
  )
}

export function PortfolioSummaryBar({ result, positions }) {
  const netValue = result ? result.net_npv : null
  const netPositive = netValue != null && netValue >= 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>가격 결과</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-5">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Net NPV
            </div>
            <div
              className={cn(
                'mt-1 text-3xl font-bold font-mono tabular-nums',
                netValue == null ? 'text-muted-foreground' : netPositive ? 'text-positive' : 'text-negative',
              )}
            >
              {netValue == null ? '—' : `${netPositive ? '+' : ''}${fmt(netValue)}`}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">KRW</span>
            </div>
            {netValue != null && (
              <Badge className="mt-1.5" variant={netPositive ? 'positive' : 'negative'}>
                {fmtEok(netValue)}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3 sm:border-l sm:border-border sm:pl-10">
            {SECONDARY_STATS.map(({ key, label }) => {
              const value = result ? result[key] : null
              const positive = value != null && value >= 0
              return (
                <div key={key}>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {label}
                  </div>
                  <div
                    className={cn(
                      'mt-1 text-lg font-semibold font-mono tabular-nums',
                      value == null ? 'text-muted-foreground' : positive ? 'text-positive' : 'text-negative',
                    )}
                  >
                    {value == null ? '—' : `${positive ? '+' : ''}${fmt(value)}`}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">KRW</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {result && positions?.length > 0 && (
          <>
            <Separator />
            <NpvBreakdown positions={positions} result={result} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
