import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useDateQuotes, parRatePctFromEntry } from '@/lib/useDateQuotes'
import { apiPost } from '@/lib/api'

const TENORS = ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y']
const METHODS = [
  { method: 'flat', label: 'Flat' },
  { method: 'linear', label: 'Linear' },
  { method: 'cubic', label: 'Cubic' },
]

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function NpvComparisonPanel({ valuationDate, quotes, cdRate }) {
  const [tradeDate, setTradeDate] = useState('')
  const [tenor, setTenor] = useState('5Y')
  const [notional, setNotional] = useState('10000000000')
  const [fixedRatePct, setFixedRatePct] = useState('')
  const [results, setResults] = useState(null) // { flat: {...}|'loading'|'error', linear, cubic }

  const tradeDateEntry = useDateQuotes(tradeDate)
  const tradeDateParRatePct = parRatePctFromEntry(tradeDateEntry, tenor)
  const matchedQuote = quotes?.find((q) => q.tenor === tenor)
  const valuationParRatePct = matchedQuote ? (matchedQuote.rate * 100).toFixed(4) : null

  const fixedRateDecimal = fixedRatePct !== '' ? Number(fixedRatePct) / 100 : null
  const ready = Boolean(tradeDate && fixedRateDecimal != null && quotes?.length && valuationDate)

  useEffect(() => {
    if (!ready) {
      setResults(null)
      return
    }
    let cancelled = false
    const swapQuotes = quotes.map((q) => ({ tenor_years: parseInt(q.tenor, 10), rate: q.rate }))
    setResults({ flat: 'loading', linear: 'loading', cubic: 'loading' })

    METHODS.forEach(({ method }) => {
      apiPost('/api/mtm', {
        valuation_date: valuationDate,
        cd_rate: Number(cdRate),
        swap_quotes: swapQuotes,
        swap: {
          trade_date: tradeDate,
          tenor_years: parseInt(tenor, 10),
          notional: Number(notional),
          fixed_rate: fixedRateDecimal,
          pay_fixed: true,
          float_spread: 0.0,
        },
        interpolation_method: method,
      })
        .then((body) => {
          if (cancelled) return
          setResults((r) => ({ ...r, [method]: body }))
        })
        .catch((err) => {
          if (cancelled) return
          setResults((r) => ({ ...r, [method]: { error: err.message } }))
        })
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, valuationDate, cdRate, tradeDate, tenor, notional, fixedRateDecimal])

  return (
    <Card>
      <CardHeader>
        <CardTitle>NPV 영향 비교</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          기존 거래 재평가 입력값을 그대로 사용해, 동일한 거래를 보간법만 바꿔가며 재평가합니다.
          Par rate 자체는 평가일 커브의 해당 테너 quote와 동일하지만(보간법에 따라 달라지지 않음),
          NPV는 잔존 기간 동안의 변동금리 예측이 보간법에 따라 달라지기 때문에 차이가 날 수
          있습니다.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-trade-date">거래일</Label>
            <Input
              id="cc-trade-date"
              type="date"
              value={tradeDate}
              max={valuationDate || undefined}
              onChange={(e) => setTradeDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-notional">명목원금 (KRW)</Label>
            <Input
              id="cc-notional"
              type="number"
              min="1"
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
            />
          </div>
        </div>

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

        <div className="space-y-1.5">
          <Label htmlFor="cc-fixed-rate">
            약정 고정금리 (%)
            {tradeDateParRatePct && (
              <span className="ml-2 text-[11px] text-muted-foreground font-normal">
                Par {tradeDateParRatePct}%
              </span>
            )}
          </Label>
          <Input
            id="cc-fixed-rate"
            type="number"
            step="0.0001"
            value={fixedRatePct}
            onChange={(e) => setFixedRatePct(e.target.value)}
            placeholder={tradeDateParRatePct ? `${tradeDateParRatePct} (par)` : '예: 2.8500'}
          />
          {tradeDate && tradeDateEntry?.status === 'loading' && (
            <p className="text-[11px] text-muted-foreground italic">
              계약일 기준 par rate 조회 중… (최초 조회는 몇 초 정도 걸릴 수 있습니다)
            </p>
          )}
          {tradeDate && tradeDateEntry?.status === 'error' && (
            <p className="text-[11px] text-destructive">{tradeDateEntry.message}</p>
          )}
          {tradeDate && tradeDateEntry?.status === 'ok' && tradeDateParRatePct && (
            <p className="text-[11px] text-muted-foreground italic">
              예시: 계약일(trade date) 기준 {tenor} par rate는 {tradeDateParRatePct}%였습니다 — 실제
              계약 고정금리를 입력하세요.
            </p>
          )}
        </div>

        {!ready && (
          <p className="text-xs text-muted-foreground">
            거래일과 약정 고정금리를 입력하면 보간법별 NPV가 표시됩니다.
          </p>
        )}

        {results && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>보간법</TableHead>
                <TableHead className="text-right">Par rate ({tenor})</TableHead>
                <TableHead className="text-right">Clean NPV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METHODS.map(({ method, label }) => {
                const r = results[method]
                return (
                  <TableRow key={method}>
                    <TableCell className="text-xs font-medium">{label}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {valuationParRatePct ? `${valuationParRatePct}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r === 'loading' && '조회 중…'}
                      {r?.error && <span className="text-destructive">{r.error}</span>}
                      {r && r !== 'loading' && !r.error && `${fmt(r.clean_npv)} KRW`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
