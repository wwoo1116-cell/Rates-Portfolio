import { useMemo, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { buildQuarterlyPeriods } from '@/lib/methodologyMath'

const TRADE_DATE = new Date('2026-01-15T00:00:00Z')

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function LegComparisonDemo() {
  const [notional, setNotional] = useState(10000) // millions KRW
  const [fixedRatePct, setFixedRatePct] = useState(2.8)
  const [tenorYears, setTenorYears] = useState(3)

  const periods = useMemo(() => {
    const maturity = new Date(TRADE_DATE)
    maturity.setUTCFullYear(maturity.getUTCFullYear() + tenorYears)
    return buildQuarterlyPeriods(TRADE_DATE, maturity)
  }, [tenorYears])

  // Illustrative only: assume a flat quarterly accrual fraction of ~0.25.
  const fixedCashflow = notional * (fixedRatePct / 100) * 0.25
  const maxBarHeight = 64

  // Floating cash flows are unknown ahead of time -- show a plausible random-ish
  // band around the fixed rate to convey "uncertain, will vary period to period."
  const floatingHeights = useMemo(
    () =>
      periods.map((_, i) => {
        const wiggle = Math.sin(i * 1.7) * 0.35 + Math.cos(i * 0.6) * 0.2
        return Math.max(0.25, 1 + wiggle)
      }),
    [periods],
  )

  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/90 leading-relaxed">
        <strong>고정 레그</strong>는 매 기간 동일한 금리를 지급합니다 — 현금흐름이 거래 시점에
        전부 확정됩니다. <strong>변동 레그</strong>는 매 기간 CD91 커브를 기준으로 금리가
        재설정되므로, 현재 진행 중인 기간을 제외한 모든 현금흐름은 실제로 확정되기 전까지
        불확실합니다. 아래 변수를 조정해 보면 고정 레그만 반응하는 것을 확인할 수 있습니다 —
        변동 레그 막대는 이 불확실성을 나타내기 위해 음영 처리되어 있습니다.
      </p>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">명목원금</span>
            <span className="font-mono text-foreground">₩{fmt(notional)}M</span>
          </div>
          <Slider min={1000} max={20000} step={500} value={notional} onChange={(e) => setNotional(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">고정금리</span>
            <span className="font-mono text-foreground">{fixedRatePct.toFixed(2)}%</span>
          </div>
          <Slider min={1} max={5} step={0.05} value={fixedRatePct} onChange={(e) => setFixedRatePct(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">테너</span>
            <span className="font-mono text-foreground">{tenorYears}Y</span>
          </div>
          <Slider min={1} max={10} step={1} value={tenorYears} onChange={(e) => setTenorYears(Number(e.target.value))} />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            고정 레그 — 분기마다 ₩{fmt(fixedCashflow)}M
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex items-end gap-1 h-20 min-w-[480px]">
              {periods.map((p) => (
                <div
                  key={p.index}
                  title={`₩${fmt(fixedCashflow)}M`}
                  className="flex-1 bg-primary rounded-t-sm"
                  style={{ height: `${maxBarHeight}px` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            변동 레그 — 현재 기간 이후는 금리 미확정
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex items-end gap-1 h-20 min-w-[480px]">
              {periods.map((p, i) => (
                <div
                  key={p.index}
                  title="불확실 -- 아직 관측되지 않은 CD91 고시금리에 따라 결정됨"
                  className="flex-1 rounded-t-sm"
                  style={{
                    height: `${Math.round(maxBarHeight * floatingHeights[i])}px`,
                    background:
                      'repeating-linear-gradient(135deg, var(--chart-2), var(--chart-2) 5px, var(--chart-1) 5px, var(--chart-1) 10px)',
                    opacity: 0.85,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        변동 레그의 막대 높이는 예시를 위한 임의값일 뿐 예측치가 아닙니다 — 요점은 고정 레그와
        달리 그 모양을 사전에 확정적으로 그릴 수 없다는 것입니다. 4번 섹션에서 커브가 실제로
        이 선도금리들을 어떻게 추정하는지 보여드립니다.
      </p>
    </div>
  )
}
