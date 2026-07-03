import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { BusinessDayPicker } from '@/components/ui/business-day-picker'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { usePositionFairRate, fetchHistoricalQuote } from '@/lib/useFairRate'
import { fmt, fmtRate4 } from '@/lib/format'
import { TENOR_OPTIONS, useTenorDates } from '@/lib/useCalendar'

export function PositionRow({ position, onChange, onRemove, canRemove, valuationDate, cdRate, quotes, npv }) {
  const { id, startDate, maturityDate, notional, fixedRatePct, direction } = position

  // Debounced so rapid start/maturity changes (e.g. clicking through
  // calendar months) don't fire a fair-rate fetch per intermediate value.
  const debouncedStartDate = useDebouncedValue(startDate)
  const debouncedMaturityDate = useDebouncedValue(maturityDate)

  const isNewTrade = Boolean(debouncedStartDate && valuationDate && debouncedStartDate >= valuationDate)

  // The forward par rate for THIS exact schedule, priced off TODAY's
  // valuation snapshot -- not a linear interpolation across quoted tenors,
  // which only happens to be exact for a spot-starting, whole-year swap.
  // Plugging this into 고정금리 is guaranteed to price to ~0 NPV as of today;
  // the old interpolated hint was not (see fair_rate_for_schedule's docstring).
  //
  // Shown ONLY for new trades: for a historical position this same number is
  // "today's forward breakeven for the remaining life," a completely
  // different concept from the fixed rate the user needs to type in (the
  // rate actually contracted back then) -- surfacing it there was pure
  // cognitive clutter with no actionable meaning, so it's hidden entirely.
  const fairRateEntry = usePositionFairRate(valuationDate, cdRate, quotes, debouncedStartDate, debouncedMaturityDate)
  const parRatePct = isNewTrade && fairRateEntry?.status === 'ok' ? fmtRate4(fairRateEntry.fairRate) : null

  useEffect(() => {
    if (!isNewTrade) return
    if (fairRateEntry?.status !== 'ok') return
    const precise = String(fairRateEntry.fairRate * 100)
    if (precise !== fixedRatePct) onChange(id, 'fixedRatePct', precise)
  }, [isNewTrade, fairRateEntry, id, onChange, fixedRatePct])

  // Historical trades get no auto-fill (see above) -- instead a manual
  // "과거 금리 조회" button, which fetches the rate actually quoted ON 시작일
  // itself (that day's own market snapshot, not today's curve) and fills it
  // in as a one-shot action. Local state because this is imperative/
  // button-triggered, not a reactive hint like the new-trade fair rate.
  const [historicalQuote, setHistoricalQuote] = useState({ status: 'idle' })
  async function handleFetchHistoricalQuote() {
    setHistoricalQuote({ status: 'loading' })
    try {
      const rate = await fetchHistoricalQuote(debouncedStartDate, debouncedMaturityDate, Number(notional) || 100_000_000)
      onChange(id, 'fixedRatePct', String(rate * 100))
      setHistoricalQuote({ status: 'ok' })
    } catch (err) {
      setHistoricalQuote({ status: 'error', message: err.message })
    }
  }

  // Business-day-adjusted maturity date for each quick-select tenor, given
  // the current start date -- computed server-side (QuantLib SouthKorea +
  // Modified Following) so a tenor button always lands on a date the
  // calendar picker itself would accept.
  const tenorDates = useTenorDates(startDate)
  const matchedMonths = Object.entries(tenorDates).find(([, iso]) => iso && iso === maturityDate)?.[0]

  const npvPositive = npv != null && npv >= 0

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1.4fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`start-date-${id}`}>시작일</Label>
            <BusinessDayPicker
              id={`start-date-${id}`}
              value={startDate}
              onChange={(iso) => onChange(id, 'startDate', iso)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`maturity-date-${id}`}>만기일</Label>
            <BusinessDayPicker
              id={`maturity-date-${id}`}
              value={maturityDate}
              minDateExclusive={startDate || undefined}
              onChange={(iso) => onChange(id, 'maturityDate', iso)}
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
            <div className="flex gap-1.5">
              <Input
                id={`fixed-rate-${id}`}
                type="number"
                step="0.0001"
                value={fixedRatePct}
                onChange={(e) => onChange(id, 'fixedRatePct', e.target.value)}
                placeholder={parRatePct ? `예: ${parRatePct}` : ''}
                className="min-w-0"
              />
              {!isNewTrade && startDate && maturityDate && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 px-2.5 text-xs whitespace-nowrap"
                  disabled={historicalQuote.status === 'loading'}
                  onClick={handleFetchHistoricalQuote}
                  title="시작일 당시 실제 시장에서 고시되던 금리를 조회합니다 (오늘 커브 아님)"
                >
                  {historicalQuote.status === 'loading' ? '조회 중…' : '과거 금리 조회'}
                </Button>
              )}
            </div>
            {historicalQuote.status === 'error' && (
              <p className="text-[11px] text-destructive">{historicalQuote.message}</p>
            )}
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

        {/* Footer row: tenor quick-select on the left (under 시작일/만기일),
            this position's own evaluated NPV pinned to the far right -- the
            user sees each trade's P&L without scrolling down to the summary. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TENOR_OPTIONS.map(({ label, months }) => {
              const targetDate = tenorDates[months]
              const isMatched = String(months) === matchedMonths
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!startDate || !targetDate}
                  onClick={() => onChange(id, 'maturityDate', targetDate)}
                  title={targetDate ? `만기일: ${targetDate}` : undefined}
                  className={cn(
                    'px-2.5 py-1 rounded-sm text-xs font-medium border transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    isMatched
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary hover:text-primary',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">NPV</span>
            <span
              className={cn(
                'font-mono font-semibold tabular-nums text-sm',
                npv == null ? 'text-muted-foreground' : npvPositive ? 'text-positive' : 'text-negative',
              )}
            >
              {npv == null ? '계산 전' : `${npvPositive ? '+' : ''}${fmt(npv)}`}
              {npv != null && <span className="ml-1 text-[11px] font-normal text-muted-foreground">KRW</span>}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
