import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IrsSpecForm } from './IrsSpecForm'
import { PnLTraceChart } from './PnLTraceChart'
import { HistoricalSnapshotView } from './HistoricalSnapshotView'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'

// This app has no prior modal/side-panel component to match -- built here as
// a plain fixed-position slide-over on top of the existing Card/Table/Input
// primitives, per DESIGN.md's "no decoration for decoration's sake": a
// hairline left border instead of a heavy shadow, a scrim only dark enough
// to establish overlay depth.
export function TradeDetailPanel({ detail }) {
  const {
    selectedTrade,
    selectedDate,
    irsSpec,
    snapshot,
    snapshotLoading,
    snapshotError,
    npvTrace,
    npvTraceLoading,
    npvTraceError,
    closeTrade,
    updateSpec,
    repriceSpec,
    inspectDate,
  } = detail

  useEffect(() => {
    if (!selectedTrade) return
    function onKey(e) {
      if (e.key === 'Escape') closeTrade()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedTrade, closeTrade])

  if (!selectedTrade) return null

  const isDraft = !!selectedTrade.is_draft

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-background/60" onClick={closeTrade} />
      <div className="relative h-full w-full max-w-[560px] overflow-y-auto border-l border-border bg-card shadow-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <div>
            {isDraft ? (
              <>
                <div className="text-sm font-semibold text-foreground">가상 진입 시나리오 · {selectedTrade.entry_date}</div>
                <div className="text-xs text-muted-foreground">What-If -- 실제 체결/백테스트 거래가 아닙니다.</div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-foreground">
                  {selectedTrade.entry_date} → {selectedTrade.exit_date}
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedTrade.direction === 1 ? 'Long' : 'Short'} spread ·{' '}
                  <span className={selectedTrade.pnl >= 0 ? 'text-positive' : 'text-negative'}>
                    {fmt(selectedTrade.pnl)}
                  </span>
                </div>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={closeTrade} aria-label="닫기">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              시장 스냅샷
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  selectedDate === selectedTrade.entry_date
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
                onClick={() => inspectDate(selectedTrade.entry_date)}
              >
                진입일 {selectedTrade.entry_date}
              </button>
              {!isDraft && (
                <button
                  type="button"
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    selectedDate === selectedTrade.exit_date
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                  onClick={() => inspectDate(selectedTrade.exit_date)}
                >
                  청산일 {selectedTrade.exit_date}
                </button>
              )}
            </div>
            <HistoricalSnapshotView snapshot={snapshot} loading={snapshotLoading} error={snapshotError} />
          </section>

          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {isDraft ? '가상 트레이드 설정 (What-If Trade Setup)' : 'IRS 스펙'}
            </div>
            <IrsSpecForm
              spec={irsSpec}
              onChange={updateSpec}
              onReprice={repriceSpec}
              loading={npvTraceLoading}
              isDraft={isDraft}
            />
          </section>

          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              일별 NPV / 손익 추이
            </div>
            {npvTraceError && <p className="text-xs text-destructive">{npvTraceError}</p>}
            <PnLTraceChart trace={npvTrace} loading={npvTraceLoading} />
          </section>
        </div>
      </div>
    </div>
  )
}
