import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useDateQuotes, parRatePctFromEntry } from '@/lib/useDateQuotes'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { fmtRate4 } from '@/lib/format'
import { apiPost } from '@/lib/api'

const TENORS = ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y']

export function SwapForm({ valuationDate, quotes, cdRate, disabled, onResult }) {
  const [mode, setMode] = useState('new') // 'new' = price a fresh trade, 'mtm' = revalue a booked trade
  const [tenor, setTenor] = useState('5Y')
  const [notional, setNotional] = useState('10000000000')
  const [fixedRatePct, setFixedRatePct] = useState('')
  const [direction, setDirection] = useState('pay')
  const [tradeDate, setTradeDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const matchedQuote = quotes?.find((q) => q.tenor === tenor)
  const parRatePct = matchedQuote ? fmtRate4(matchedQuote.rate) : null

  // MTM mode's example must reflect the rate that was realistic when the
  // trade was booked (trade_date), not today's rate (valuationDate) -- using
  // valuationDate here would misleadingly show today's par rate as if it
  // were the historical contracted rate. Debounced so keyboard entry in the
  // date input doesn't fire a fetch per keystroke.
  const debouncedTradeDate = useDebouncedValue(tradeDate)
  const tradeDateEntry = useDateQuotes(mode === 'mtm' ? debouncedTradeDate : '')
  const tradeDateParRatePct = parRatePctFromEntry(tradeDateEntry, tenor)

  const activeParRatePct = mode === 'mtm' ? tradeDateParRatePct : parRatePct

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const tenorYears = parseInt(tenor, 10)
    const swapQuotes = (quotes ?? []).map((q) => ({
      tenor_years: parseInt(q.tenor, 10),
      rate: q.rate,
    }))

    if (mode === 'mtm') {
      if (!tradeDate) {
        setError('재평가하려면 거래일을 입력해야 합니다.')
        return
      }
      if (fixedRatePct === '') {
        setError('재평가하려면 약정 고정금리를 입력해야 합니다.')
        return
      }
      setLoading(true)
      try {
        const data = await apiPost('/api/mtm', {
          valuation_date: valuationDate,
          cd_rate: Number(cdRate),
          swap_quotes: swapQuotes,
          swap: {
            trade_date: tradeDate,
            tenor_years: tenorYears,
            notional: Number(notional),
            fixed_rate: Number(fixedRatePct) / 100,
            pay_fixed: direction === 'pay',
            float_spread: 0.0,
          },
        })
        onResult(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
      return
    }

    const fixedRateDecimal =
      fixedRatePct !== ''
        ? Number(fixedRatePct) / 100
        : matchedQuote
          ? matchedQuote.rate
          : null

    if (fixedRateDecimal == null) {
      setError('해당 테너의 시장금리가 없습니다.')
      return
    }

    setLoading(true)
    try {
      const data = await apiPost('/api/price', {
        valuation_date: valuationDate,
        cd_rate: Number(cdRate),
        swap_quotes: swapQuotes,
        swap: {
          tenor_years: tenorYears,
          notional: Number(notional),
          fixed_rate: fixedRateDecimal,
          pay_fixed: direction === 'pay',
        },
      })
      onResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>스왑 조건</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* New trade / revalue booked trade */}
          <div className="space-y-1.5">
            <Label>거래 구분</Label>
            <div className="flex gap-2 mt-1">
              {[
                ['new', '신규 거래'],
                ['mtm', '기존 거래 재평가'],
              ].map(([m, mLabel]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    setError('')
                    onResult(null)
                  }}
                  className={cn(
                    'flex-1 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wide border transition-colors',
                    mode === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary',
                  )}
                >
                  {mLabel}
                </button>
              ))}
            </div>
          </div>

          {mode === 'mtm' && (
            <div className="space-y-1.5">
              <Label htmlFor="trade-date">거래일</Label>
              <Input
                id="trade-date"
                type="date"
                value={tradeDate}
                max={valuationDate || undefined}
                onChange={(e) => setTradeDate(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                만기일은 거래일 + 테너로 계산되며, 잔존 현금흐름은 선택한 평가일 기준으로 재평가됩니다.
              </p>
            </div>
          )}

          {/* Tenor pills */}
          <div className="space-y-1.5">
            <Label>테너</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {TENORS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTenor(t)}
                  className={cn(
                    'px-3 py-1 rounded-sm text-xs font-medium border transition-colors',
                    tenor === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary hover:text-primary',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Pay / Receive */}
          <div className="space-y-1.5">
            <Label>방향</Label>
            <div className="flex gap-2 mt-1">
              {['pay', 'receive'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    'flex-1 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wide border transition-colors',
                    direction === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary',
                  )}
                >
                  {d === 'pay' ? '고정 지급' : '고정 수취'}
                </button>
              ))}
            </div>
          </div>

          {/* Notional */}
          <div className="space-y-1.5">
            <Label htmlFor="notional">명목원금 (KRW)</Label>
            <NumberInput
              id="notional"
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
              placeholder="10,000,000,000"
            />
          </div>

          {/* Fixed rate */}
          <div className="space-y-1.5">
            <Label htmlFor="fixed-rate">
              {mode === 'mtm' ? '약정 고정금리 (%)' : '고정금리 (%)'}
              {activeParRatePct && (
                <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                  Par {activeParRatePct}%
                </span>
              )}
            </Label>
            <Input
              id="fixed-rate"
              type="number"
              step="0.0001"
              value={fixedRatePct}
              onChange={(e) => setFixedRatePct(e.target.value)}
              placeholder={activeParRatePct ? `예: ${activeParRatePct}` : ''}
            />
            {mode === 'mtm' && tradeDate && (
              <>
                {tradeDateEntry?.status === 'loading' && (
                  <p className="text-[11px] text-muted-foreground italic">
                    계약일 기준 par rate 조회 중… (최초 조회는 몇 초 정도 걸릴 수 있습니다)
                  </p>
                )}
                {tradeDateEntry?.status === 'error' && (
                  <p className="text-[11px] text-destructive">{tradeDateEntry.message}</p>
                )}
                {tradeDateEntry?.status === 'ok' && tradeDateParRatePct && (
                  <p className="text-[11px] text-muted-foreground italic">
                    예시: 계약일(trade date) 기준 {tenor} par rate는 {tradeDateParRatePct}%였습니다 —
                    실제 계약 고정금리를 입력하세요.
                  </p>
                )}
                {tradeDateEntry?.status === 'ok' && !tradeDateParRatePct && (
                  <p className="text-[11px] text-muted-foreground">
                    계약일 기준 {tenor} 시장금리가 없습니다.
                  </p>
                )}
              </>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full"
            disabled={disabled || loading || !valuationDate}
          >
            {loading ? '계산 중…' : mode === 'mtm' ? '재평가 실행' : 'NPV 계산'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
