import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { buildBootstrapSteps, DEMO_CD_RATE, DEMO_PAR_RATES } from '@/lib/methodologyMath'

const TENORS = [1, 2, 3, 5, 7, 10]
const CONTAINER_H = 96

function pct(r) {
  return `${(r * 100).toFixed(3)}%`
}

export function FlatForwardDemo() {
  const [tenor, setTenor] = useState(1)
  const steps = useMemo(() => buildBootstrapSteps(DEMO_CD_RATE, DEMO_PAR_RATES), [])

  const relevantSteps = steps.filter((s) => s.toYears <= tenor)
  const quarters = relevantSteps.flatMap((s) =>
    Array.from({ length: s.quarters }, (_, i) => ({
      key: `${s.label}-${i}`,
      rate: s.rate,
      segmentLabel: s.label,
      isFirstSegment: s.index === 0,
    })),
  )
  const parRate = DEMO_PAR_RATES[tenor]

  const allValues = [...quarters.map((q) => q.rate), parRate]
  const minRate = Math.min(...allValues)
  const maxRate = Math.max(...allValues)
  const barHeight = (rate) => {
    if (maxRate === minRate) return 48
    return 16 + ((rate - minRate) / (maxRate - minRate)) * 64
  }
  const parLineTop = CONTAINER_H - barHeight(parRate)

  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/90 leading-relaxed">
        특정 테너의 고시 par 금리가 만기까지 균일하게 적용된다고 착각하기 쉽습니다 — 예를 들어
        1Y par 금리가 1년 내내 4개 분기 모두에 동일하게 적용되는 "그 금리"라고 생각하기 쉽지만,
        그렇지 않습니다. par 금리는 가중평균값입니다. 각 <em>부트스트랩 구간</em> 내에서는 선도
        금리가 flat(일정)하다고 가정하지만, 구간마다 — 그리고 이미 확정된 0–3M CD91 고시금리도 —
        서로 다른 수준에 있을 수 있습니다.
      </p>

      <div className="flex flex-wrap gap-1.5">
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
            {t}Y
          </button>
        ))}
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="relative min-w-[480px]" style={{ height: `${CONTAINER_H + 24}px` }}>
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-foreground/60 z-10"
            style={{ top: `${parLineTop}px` }}
          >
            <span className="absolute -top-5 right-0 text-[11px] font-semibold text-foreground bg-card px-1">
              고시 {tenor}Y par 금리: {pct(parRate)}
            </span>
          </div>
          <div className="flex items-end gap-0.5" style={{ height: `${CONTAINER_H}px` }}>
            {quarters.map((q, i) => (
              <div
                key={q.key}
                title={`${q.segmentLabel}: ${pct(q.rate)}`}
                className={cn(
                  'flex-1 rounded-t-sm',
                  q.isFirstSegment ? 'bg-amber-500' : 'bg-primary',
                )}
                style={{ height: `${barHeight(q.rate)}px` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> 확정된 CD91 고시금리 (0–3M)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> 부트스트랩된 flat-forward 구간
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-0.5 border-t-2 border-dashed border-foreground/60 inline-block" /> 고시 par 금리 (가중평균)
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        각 색상 막대 블록은 자신의 구간 내에서는 평평합니다(높이 동일) — 해당 구간의 선도금리가
        4번 섹션에서 단일 값으로 풀렸기 때문입니다. 하지만 모든 블록이 점선의 par 금리 위에
        놓이지는 않습니다 — 그 선은 {tenor}Y 전체의 평균이지, 개별 분기 하나의 금리가 아닙니다.
      </p>
    </div>
  )
}
