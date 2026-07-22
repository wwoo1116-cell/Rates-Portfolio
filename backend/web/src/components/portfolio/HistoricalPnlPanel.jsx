import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { apiPost } from '@/lib/api'
import { fmt, fmtEok } from '@/lib/format'
import { HistoricalPnlDashboard } from './HistoricalPnlDashboard'

export function HistoricalPnlPanel({ positions, dateRange }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!startDate || !endDate) {
      setError('조회 시작일과 종료일을 입력해야 합니다.')
      return
    }
    for (const p of positions) {
      if (!p.startDate || !p.maturityDate || p.fixedRatePct === '') {
        setError('모든 포지션에 시작일/만기일/고정금리를 입력해야 합니다.')
        return
      }
    }

    setLoading(true)
    try {
      const data = await apiPost('/api/portfolio/historical-pnl', {
        positions: positions.map((p) => ({
          position_id: p.id,
          start_date: p.startDate,
          maturity_date: p.maturityDate,
          notional: Number(p.notional),
          fixed_rate: Number(p.fixedRatePct) / 100,
          pay_fixed: p.direction === 'pay',
        })),
        start_date: startDate,
        end_date: endDate,
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const latest = result?.points?.[result.points.length - 1]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historical PnL</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label htmlFor="hpnl-start">시작일</Label>
            <Input
              id="hpnl-start"
              type="date"
              value={startDate}
              min={dateRange?.min}
              max={endDate || dateRange?.max}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hpnl-end">종료일</Label>
            <Input
              id="hpnl-end"
              type="date"
              value={endDate}
              min={startDate || dateRange?.min}
              max={dateRange?.max}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? '조회 중…' : '조회'}
          </Button>
        </form>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">기준일 {result.baseline_date} 대비 누적 PnL</span>
              <span
                className={cn(
                  'font-mono tabular-nums font-semibold',
                  latest.cumulative_pnl >= 0 ? 'text-positive' : 'text-negative',
                )}
              >
                {latest.cumulative_pnl >= 0 ? '+' : ''}
                {fmt(latest.cumulative_pnl)} KRW
                <span className="ml-1 text-[11px] text-muted-foreground font-normal">
                  ({fmtEok(latest.cumulative_pnl)})
                </span>
              </span>
            </div>

            <HistoricalPnlDashboard points={result.points} />

            {result.skipped_dates.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                활성 포지션이 없어 0으로 표시된 날짜: {result.skipped_dates.length}일
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
