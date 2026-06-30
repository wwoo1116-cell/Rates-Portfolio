import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

export function NpvDefinitionDemo() {
  const [direction, setDirection] = useState('pay') // 'pay' = payer swap, 'receive' = receiver swap
  const [pvFloat, setPvFloat] = useState(1035)
  const [pvFixed, setPvFixed] = useState(1000)

  const npv = direction === 'pay' ? pvFloat - pvFixed : pvFixed - pvFloat
  const npvVariant = npv > 0 ? 'positive' : npv < 0 ? 'negative' : 'outline'

  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/90 leading-relaxed">
        스왑의 NPV는 단순히 받는 현금흐름의 현재가치에서 지급하는 현금흐름의 현재가치를 뺀
        값입니다. 따라서 <strong>페이어 스왑</strong>(고정금리 지급, 변동금리 수취)의 가치는{' '}
        <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded-sm">PV(Floating) − PV(Fixed)</code>가
        되고, <strong>리시버 스왑</strong>은 정확히 그 반대이므로 부호가 뒤집힙니다.
      </p>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">포지션</span>
        <div className="flex gap-2 mt-1 max-w-xs">
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

      <div className="rounded-sm border border-border bg-muted/40 px-4 py-3 font-mono text-sm text-center">
        NPV ={' '}
        {direction === 'pay' ? (
          <>PV(Floating) − PV(Fixed)</>
        ) : (
          <>PV(Fixed) − PV(Floating)</>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">PV(변동 레그)</span>
            <span className="font-mono text-foreground">₩{fmt(pvFloat)}M</span>
          </div>
          <Slider
            min={800}
            max={1200}
            step={5}
            value={pvFloat}
            onChange={(e) => setPvFloat(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">PV(고정 레그)</span>
            <span className="font-mono text-foreground">₩{fmt(pvFixed)}M</span>
          </div>
          <Slider
            min={800}
            max={1200}
            step={5}
            value={pvFixed}
            onChange={(e) => setPvFixed(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">결과 NPV</span>
        <Badge variant={npvVariant}>
          {npv >= 0 ? '+' : ''}₩{fmt(npv)}M
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        같은 두 레그 값이라도 고정 지급 ↔ 고정 수취를 바꾸면 NPV의 부호가 뒤집힙니다 — 스왑의
        두 거래상대방은 항상 정반대 부호의 NPV를 갖는데, 한쪽의 수취가 다른 쪽의 지급이기
        때문입니다.
      </p>
    </div>
  )
}
