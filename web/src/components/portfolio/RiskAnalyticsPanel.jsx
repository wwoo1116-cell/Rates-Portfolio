import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { fmt } from '@/lib/format'
import { apiPost } from '@/lib/api'
import { buildPortfolioRequest } from '@/lib/portfolioRequest'
import { DeltaLadderChart } from './DeltaLadderChart'

// Display-only tenor label -- same helper/shape as PortfolioSummaryBar's
// NpvBreakdown; cosmetic grouping only, not used in pricing.
function tenorLabel(startDate, maturityDate) {
  if (!startDate || !maturityDate) return '—'
  const ms = new Date(`${maturityDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)
  const years = ms / (365.25 * 24 * 60 * 60 * 1000)
  return Number.isFinite(years) && years > 0 ? `${years.toFixed(1)}Y` : '—'
}

export function RiskAnalyticsPanel({ positions, valuationDate, effectiveMarket, apiDataSource, marketBlocked }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  async function handleCompute() {
    setError('')
    setLoading(true)
    try {
      const data = await apiPost(
        '/api/portfolio/delta',
        buildPortfolioRequest(positions, valuationDate, effectiveMarket, apiDataSource),
      )
      setResult(data)
      setSelectedId(data.position_deltas[0]?.position_id ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const positionById = new Map(positions.map((p) => [p.id, p]))
  const selectedDelta = result?.position_deltas.find((pd) => pd.position_id === selectedId)
  const totalPositive = result != null && result.total_delta >= 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Risk Analytics</CardTitle>
          <Button type="button" onClick={handleCompute} disabled={marketBlocked || loading}>
            {loading ? '계산 중…' : '델타 계산'}
          </Button>
        </CardHeader>
        <CardContent className="pt-0 space-y-5">
          {error && <p className="text-xs text-destructive">{error}</p>}

          {!result && !error && (
            <p className="text-sm text-muted-foreground">
              델타 계산을 실행하면 포트폴리오 전체와 개별 포지션의 커브 테너별 금리 민감도(델타)를 확인할 수
              있습니다.
            </p>
          )}

          {result && (
            <>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Total Delta · 포트폴리오 (KRW/bp)
                </div>
                <div
                  className={cn(
                    'mt-1 text-3xl font-bold font-mono tabular-nums',
                    totalPositive ? 'text-positive' : 'text-negative',
                  )}
                >
                  {totalPositive ? '+' : ''}
                  {fmt(result.total_delta)}
                </div>
              </div>

              <Separator />

              <DeltaLadderChart buckets={result.buckets} title="포트폴리오 델타 래더 · 테너별" />
            </>
          )}
        </CardContent>
      </Card>

      {result && result.position_deltas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>포지션별 델타</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <ul className="divide-y divide-border">
              {result.position_deltas
                .slice()
                .sort((a, b) => Math.abs(b.total_delta) - Math.abs(a.total_delta))
                .map((pd) => {
                  const position = positionById.get(pd.position_id)
                  const positive = pd.total_delta >= 0
                  const selected = pd.position_id === selectedId
                  return (
                    <li key={pd.position_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(pd.position_id)}
                        className={cn(
                          'w-full flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-sm text-left transition-colors',
                          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs text-muted-foreground">
                          <Badge variant="outline">{position?.direction === 'pay' ? '고정지급' : '고정수취'}</Badge>
                          <span>{tenorLabel(position?.startDate, position?.maturityDate)}</span>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 font-mono font-semibold tabular-nums text-sm',
                            positive ? 'text-positive' : 'text-negative',
                          )}
                        >
                          {positive ? '+' : ''}
                          {fmt(pd.total_delta)}
                        </span>
                      </button>
                    </li>
                  )
                })}
            </ul>

            <Separator />

            {selectedDelta ? (
              <DeltaLadderChart
                buckets={selectedDelta.buckets}
                title={`선택된 포지션 델타 래더 · ${selectedDelta.position_id}`}
              />
            ) : (
              <p className="text-sm text-muted-foreground">포지션을 선택하면 해당 포지션의 델타 래더가 표시됩니다.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
