import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

const NOTIONAL = 10000 // millions KRW, illustrative
const TENOR_YEARS = 3
const BASE_PV_FLOAT = 1035
const BASE_PV_FIXED = 1000
const MAX_BPS = 50

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export function SingleDualCurveDemo() {
  const [mode, setMode] = useState('single')
  const [basisBps, setBasisBps] = useState(15)

  const npvSingle = BASE_PV_FLOAT - BASE_PV_FIXED
  // Illustrative only: discounting off a lower risk-free (KOFR) curve while
  // projecting off the higher CD91 curve raises the floating leg's PV
  // relative to the single-curve approximation -- not a real basis-adjusted
  // bootstrap, just enough to show the direction and rough magnitude.
  const dualAdjustment = NOTIONAL * (basisBps / 10000) * TENOR_YEARS * 0.5
  const npvDual = npvSingle + dualAdjustment

  const kofrWidthPct = 100 - (basisBps / MAX_BPS) * 35

  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/90 leading-relaxed">
        엄밀한 스왑 평가 체계는 무위험/담보 커브(한국에서는 익일물 <strong>KOFR</strong>)로
        현금흐름을 할인하고, 변동 현금흐름은 스왑이 실제로 참조하는 지표금리 커브
        (<strong>CD91</strong>)로 추정합니다. CD91은 KOFR이 반영하지 않는 은행 자금조달 리스크를
        반영하기 때문에, 신용·유동성 베이시스 스프레드만큼 KOFR보다 높게 형성됩니다.
      </p>
      <p className="text-sm font-medium text-foreground bg-muted/50 border border-border rounded-sm px-3 py-2">
        이 계산기는 현재 할인과 변동금리 추정 모두에 단일 CD91 커브를 사용합니다. 이는 근사치이며
        CD91/KOFR 베이시스를 완전히 무시합니다. 아래 토글로 베이시스를 반영했을 때 NPV가 대략
        어떻게 달라지는지 확인할 수 있습니다.
      </p>

      {/* Curve diagram */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] w-24 text-muted-foreground shrink-0">CD91 (사용 중)</span>
          <div className="flex-1 h-2.5 rounded-full bg-primary" style={{ width: '100%' }} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] w-24 text-muted-foreground shrink-0">KOFR (무위험)</span>
          <div className="flex-1 relative h-2.5">
            <div
              className="h-2.5 rounded-full bg-muted-foreground/40"
              style={{ width: `${kofrWidthPct}%` }}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground pl-[6.5rem]">
          ← 간격이 {basisBps}bp의 신용·유동성 베이시스 스프레드를 나타냄
        </p>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">커브 모드</span>
        <div className="flex gap-2 mt-1 max-w-sm">
          {['single', 'dual'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wide border transition-colors',
                mode === m
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-border hover:border-primary',
              )}
            >
              {m === 'single' ? '싱글 커브 (현재)' : '듀얼 커브 (가정)'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className={cn('text-muted-foreground', mode !== 'dual' && 'opacity-40')}>
            CD91 / KOFR 베이시스 스프레드
          </span>
          <span className={cn('font-mono text-foreground', mode !== 'dual' && 'opacity-40')}>
            {basisBps}bp
          </span>
        </div>
        <Slider
          min={0}
          max={MAX_BPS}
          step={1}
          value={basisBps}
          disabled={mode !== 'dual'}
          onChange={(e) => setBasisBps(Number(e.target.value))}
          className={cn(mode !== 'dual' && 'opacity-40')}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div
          className={cn(
            'rounded-sm border px-3 py-3 space-y-1',
            mode === 'single' ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            싱글 커브 NPV
          </div>
          <Badge variant={npvSingle >= 0 ? 'positive' : 'negative'}>
            {npvSingle >= 0 ? '+' : ''}₩{fmt(npvSingle)}M
          </Badge>
        </div>
        <div
          className={cn(
            'rounded-sm border px-3 py-3 space-y-1',
            mode === 'dual' ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            듀얼 커브 NPV (근사치)
          </div>
          <Badge variant={npvDual >= 0 ? 'positive' : 'negative'}>
            {npvDual >= 0 ? '+' : ''}₩{fmt(npvDual)}M
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        여기서 듀얼 커브 수치는 재부트스트래핑된 커브가 아니라 프론트엔드에서 계산한 대략적인
        근사치입니다 — 방향성과 대략적인 민감도를 보여주기 위한 것이며, 신뢰할 수 있는 정확한
        값이 아닙니다.
      </p>
    </div>
  )
}
