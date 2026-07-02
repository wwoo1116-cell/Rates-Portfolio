import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useDateQuotes } from '@/lib/useDateQuotes'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { yearFraction, interpolateParRate } from '@/lib/tenor'
import { fmtRate4 } from '@/lib/format'

export function PositionRow({ position, onChange, onRemove, canRemove }) {
  const { id, startDate, maturityDate, notional, fixedRatePct, direction } = position

  // Debounced so keyboard entry in the date inputs doesn't fire a
  // market-data fetch per keystroke.
  const debouncedStartDate = useDebouncedValue(startDate)
  const debouncedMaturityDate = useDebouncedValue(maturityDate)

  // Hint reflects the market rate as of this position's own start date, not
  // today's valuation date -- mirrors SwapForm's MTM-mode trade-date hint.
  // Quotes only carry integer-year tenors (1Y..10Y); non-integer date spans
  // are linearly interpolated between the adjacent quoted tenors.
  const startDateEntry = useDateQuotes(debouncedStartDate)
  const years = yearFraction(debouncedStartDate, debouncedMaturityDate)
  const parRatePct =
    startDateEntry?.status === 'ok' && years != null
      ? fmtRate4(interpolateParRate(startDateEntry.quotes, years))
      : null

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`start-date-${id}`}>시작일</Label>
            <Input
              id={`start-date-${id}`}
              type="date"
              value={startDate}
              max={maturityDate || undefined}
              onChange={(e) => onChange(id, 'startDate', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`maturity-date-${id}`}>만기일</Label>
            <Input
              id={`maturity-date-${id}`}
              type="date"
              value={maturityDate}
              min={startDate || undefined}
              onChange={(e) => onChange(id, 'maturityDate', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`notional-${id}`}>명목원금 (KRW)</Label>
            <NumberInput
              id={`notional-${id}`}
              value={notional}
              onChange={(e) => onChange(id, 'notional', e.target.value)}
              placeholder="10,000,000,000"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`fixed-rate-${id}`}>
              고정금리 (%)
              {parRatePct && (
                <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                  Par {parRatePct}%
                </span>
              )}
            </Label>
            <Input
              id={`fixed-rate-${id}`}
              type="number"
              step="0.0001"
              value={fixedRatePct}
              onChange={(e) => onChange(id, 'fixedRatePct', e.target.value)}
              placeholder={parRatePct ? `예: ${parRatePct}` : ''}
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex gap-1">
              {['pay', 'receive'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange(id, 'direction', d)}
                  className={cn(
                    'px-2.5 h-9 rounded-sm text-xs font-semibold uppercase tracking-wide border transition-colors',
                    direction === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary',
                  )}
                >
                  {d === 'pay' ? '고정지급' : '고정수취'}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canRemove}
              onClick={() => onRemove(id)}
              aria-label="포지션 삭제"
              title="포지션 삭제"
            >
              ×
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
