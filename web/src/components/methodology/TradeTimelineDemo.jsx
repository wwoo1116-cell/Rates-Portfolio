import { useMemo, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { buildQuarterlyPeriods, classifyPeriod, daysBetween, formatDate, addMonths } from '@/lib/methodologyMath'

const TRADE_DATE = new Date('2024-01-15T00:00:00Z')
const MATURITY_DATE = addMonths(TRADE_DATE, 36) // 3Y demo trade
const TOTAL_DAYS = daysBetween(TRADE_DATE, MATURITY_DATE)

const STATUS_STYLE = {
  paid: {
    label: '결제 완료',
    barClass: 'bg-muted text-muted-foreground',
    swatchClass: 'bg-muted',
  },
  current: {
    label: '진행 중 (확정)',
    barClass: 'bg-amber-500 text-white',
    swatchClass: 'bg-amber-500',
  },
  future: {
    label: '미래 (추정)',
    barClass: 'text-white',
    swatchClass: '',
  },
}

const FUTURE_BG =
  'repeating-linear-gradient(135deg, var(--chart-2), var(--chart-2) 6px, var(--chart-3) 6px, var(--chart-3) 12px)'

export function TradeTimelineDemo() {
  const periods = useMemo(() => buildQuarterlyPeriods(TRADE_DATE, MATURITY_DATE), [])
  const [offsetDays, setOffsetDays] = useState(Math.round(TOTAL_DAYS * 0.45))

  const valuationDate = useMemo(
    () => new Date(TRADE_DATE.getTime() + offsetDays * 86400000),
    [offsetDays],
  )

  const classified = useMemo(
    () => periods.map((p) => ({ ...p, status: classifyPeriod(p, valuationDate) })),
    [periods, valuationDate],
  )

  const paidCount = classified.filter((p) => p.status === 'paid').length
  const currentCount = classified.filter((p) => p.status === 'current').length
  const futureCount = classified.filter((p) => p.status === 'future').length
  const markerPct = (offsetDays / TOTAL_DAYS) * 100

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/90 leading-relaxed">
        <strong>신규 거래 가격산정</strong>은 거래일 시점에 단 한 번 이루어집니다: 아직 결제된
        현금흐름이 없고, 모든 변동금리가 미확정입니다. <strong>기존 거래 재평가</strong>는 이후
        매 평가일마다 이루어집니다: 일부 기간은 이미 결제되었고, 현재 진행 중인 기간은 이미 금리가
        확정되어 있으며(CD91은 기간 시작 시점에 <em>사전</em> 고시됩니다), 그 이후 기간은 모두
        오늘자 선도 커브로 추정해야 합니다. 슬라이더를 움직여 평가일을 앞으로 이동시키면 현금흐름의
        분류가 바뀌는 것을 확인할 수 있습니다.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">평가일</span>
          <span className="font-mono font-semibold text-foreground">{formatDate(valuationDate)}</span>
        </div>
        <Slider
          min={0}
          max={TOTAL_DAYS}
          step={1}
          value={offsetDays}
          onChange={(e) => setOffsetDays(Number(e.target.value))}
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>거래일 · {formatDate(TRADE_DATE)}</span>
          <span>만기일 · {formatDate(MATURITY_DATE)}</span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="relative min-w-[640px]">
          <div className="absolute -top-5 -translate-x-1/2 text-[11px] font-semibold text-primary" style={{ left: `${markerPct}%` }}>
            ▼
          </div>
          <div
            className="absolute top-0 bottom-0 -translate-x-1/2 w-px bg-primary z-10"
            style={{ left: `${markerPct}%` }}
          />
          <div className="flex h-10 rounded-sm overflow-hidden border border-border">
            {classified.map((p) => {
              const style = STATUS_STYLE[p.status]
              const widthDays = daysBetween(p.start, p.end)
              return (
                <div
                  key={p.index}
                  title={`${formatDate(p.start)} → ${formatDate(p.end)} (${style.label})`}
                  className={`flex items-center justify-center text-[10px] font-medium border-r border-background/40 last:border-r-0 ${style.barClass}`}
                  style={{
                    flexGrow: widthDays,
                    flexBasis: 0,
                    background: p.status === 'future' ? FUTURE_BG : undefined,
                  }}
                >
                  Q{p.index + 1}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        {Object.entries(STATUS_STYLE).map(([key, s]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-sm ${s.swatchClass}`}
              style={key === 'future' ? { background: FUTURE_BG } : undefined}
            />
            {s.label}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        결제 완료 {paidCount}개 기간 · 진행 중 {currentCount}개 기간(금리 확정) · 잔존{' '}
        {futureCount}개 기간(선도 커브로 평가).
      </p>
    </div>
  )
}
