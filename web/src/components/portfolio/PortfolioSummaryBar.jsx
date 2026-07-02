import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmt, fmtEok } from '@/lib/format'

const STATS = [
  { key: 'net_npv', label: 'Net NPV' },
  { key: 'payer_npv', label: 'Payer NPV' },
  { key: 'receiver_npv', label: 'Receiver NPV' },
]

export function PortfolioSummaryBar({ result }) {
  return (
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
  )
}
