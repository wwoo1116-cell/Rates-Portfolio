import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function fieldLabelClass() {
  return 'text-[11px] uppercase tracking-wide text-muted-foreground'
}

export function IrsSpecForm({ spec, onChange, onReprice, loading, isDraft }) {
  if (!spec) return <p className="text-xs text-muted-foreground">로딩 중…</p>

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className={fieldLabelClass()}>거래일 (Trade Date)</Label>
          <Input type="date" value={spec.trade_date} onChange={(e) => onChange({ trade_date: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className={fieldLabelClass()}>Tenor (Y)</Label>
          <Input
            type="number"
            min="1"
            step="1"
            value={spec.tenor_years}
            onChange={(e) => onChange({ tenor_years: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className={fieldLabelClass()}>Notional (KRW)</Label>
          <NumberInput value={String(spec.notional)} onChange={(e) => onChange({ notional: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label className={fieldLabelClass()}>Fixed Rate (%)</Label>
          <Input
            type="number"
            step="0.0001"
            value={(spec.fixed_rate * 100).toFixed(4)}
            onChange={(e) => onChange({ fixed_rate: Number(e.target.value) / 100 })}
          />
        </div>
        <div className="space-y-1">
          <Label className={fieldLabelClass()}>Floating Index</Label>
          <Input value="CD 91D" readOnly />
        </div>
        <div className="space-y-1">
          <Label className={fieldLabelClass()}>Float Spread (bp)</Label>
          <Input
            type="number"
            step="0.1"
            value={spec.float_spread * 10000}
            onChange={(e) => onChange({ float_spread: Number(e.target.value) / 10000 })}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className={fieldLabelClass()}>Pay / Receive</Label>
          <div className="flex gap-1.5">
            <button
              type="button"
              className={cn(
                'flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                spec.pay_fixed
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground border-border hover:bg-accent',
              )}
              onClick={() => onChange({ pay_fixed: true })}
            >
              Pay Fixed
            </button>
            <button
              type="button"
              className={cn(
                'flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                !spec.pay_fixed
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground border-border hover:bg-accent',
              )}
              onClick={() => onChange({ pay_fixed: false })}
            >
              Receive Fixed
            </button>
          </div>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {isDraft ? (
          <>
            차트에서 클릭한 날짜를 거래일로, 백테스트의 장기(long) tenor 금리를 Fixed Rate 기본값으로
            채웠습니다. 실제 체결/백테스트 거래가 아닌 가상 시나리오이므로 모든 값을 자유롭게 수정한 뒤
            Run Trace로 시뮬레이션하세요.
          </>
        ) : (
          <>
            기본값은 백테스트의 장기(long) tenor와 진입일 시장 금리로 자동 채워집니다. Notional은 백테스트의
            bp당 손익 계수를 그대로 가져온 값으로 실제 액면 Notional과 다를 수 있습니다 — 반드시 확인 후
            수정하세요. 스프레드 트레이드는 2-leg 구조이지만 이 폼은 방향성을 담은 장기 레그 1개만 근사합니다.
          </>
        )}
      </p>

      <Button size="sm" onClick={onReprice} disabled={loading}>
        {loading ? '계산 중…' : isDraft ? 'Run Trace (시뮬레이션 실행)' : 'NPV 재계산'}
      </Button>
    </div>
  )
}
