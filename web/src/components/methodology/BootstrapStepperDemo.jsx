import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buildBootstrapSteps, DEMO_CD_RATE, DEMO_PAR_RATES } from '@/lib/methodologyMath'

function pct(r) {
  return `${(r * 100).toFixed(3)}%`
}

const STATUS_STYLE = {
  known: 'bg-muted text-muted-foreground',
  solving: 'bg-amber-500 text-white',
  pending: 'border border-dashed border-border text-muted-foreground/50 bg-transparent',
}

export function BootstrapStepperDemo() {
  const steps = useMemo(() => buildBootstrapSteps(DEMO_CD_RATE, DEMO_PAR_RATES), [])
  const [currentStep, setCurrentStep] = useState(0)

  const maxRate = Math.max(...steps.map((s) => s.rate))
  const minRate = Math.min(...steps.map((s) => s.rate))
  const barHeight = (rate) => {
    if (maxRate === minRate) return 40
    return 24 + ((rate - minRate) / (maxRate - minRate)) * 40
  }

  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1

  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/90 leading-relaxed">
        CD91 커브는 한 번에 관측되지 않습니다 — 만기가 짧은 구간부터 순차적으로{' '}
        <strong>부트스트래핑</strong>합니다. 매 단계마다 이미 구한 구간은 고정된 것으로 두고,
        새로 추가되는 구간만 풀어서 해당 테너의 고시 par 스왑금리가 정확히 재현되도록 합니다.
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="flex items-end gap-1 h-24 min-w-[560px]">
          {steps.map((s, i) => {
            const status = i < currentStep ? 'known' : i === currentStep ? 'solving' : 'pending'
            const revealed = i <= currentStep
            return (
              <div
                key={s.label}
                title={revealed ? `${s.label}: ${pct(s.rate)}` : `${s.label}: 아직 풀지 않음`}
                className={`flex-1 rounded-t-sm flex items-start justify-center pt-1 text-[10px] font-semibold transition-all ${STATUS_STYLE[status]}`}
                style={{ flexGrow: s.quarters, flexBasis: 0, height: revealed ? `${barHeight(s.rate)}px` : '16px' }}
              >
                {revealed ? pct(s.rate) : '?'}
              </div>
            )
          })}
        </div>
        <div className="flex gap-1 min-w-[560px] mt-1">
          {steps.map((s) => (
            <div key={s.label} className="flex-1 text-center text-[10px] text-muted-foreground" style={{ flexGrow: s.quarters, flexBasis: 0 }}>
              {s.label}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-sm border border-border bg-muted/40 px-4 py-3 text-sm space-y-1">
        <div className="font-semibold text-foreground">
          {currentStep + 1} / {steps.length} 단계 — {step.label}
        </div>
        {currentStep === 0 ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            0–3M 구간은 별도로 풀 필요가 없습니다 — 오늘자 CD91 고시금리{' '}
            <span className="font-mono text-foreground">{pct(DEMO_CD_RATE)}</span>가 그대로 직접
            관측되는 값입니다.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {step.label} 구간의 flat forward 금리를, 그 이전 모든 구간이 이미 확정되었다는 전제
            하에 {step.toYears}Y par 스왑금리(고시{' '}
            <span className="font-mono text-foreground">{pct(step.parRate)}</span>)가 정확히
            재현되도록 풉니다. 결과:{' '}
            <span className="font-mono text-foreground">{pct(step.rate)}</span>.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setCurrentStep(0)}
          disabled={currentStep === 0}
        >
          초기화
        </Button>
        <Button
          type="button"
          onClick={() => setCurrentStep((s) => Math.min(s + 1, steps.length - 1))}
          disabled={isLast}
        >
          {isLast ? '부트스트래핑 완료' : '다음 단계 →'}
        </Button>
      </div>
    </div>
  )
}
