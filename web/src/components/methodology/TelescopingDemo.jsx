import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { buildBootstrapSteps, DEMO_CD_RATE, DEMO_PAR_RATES } from '@/lib/methodologyMath'

const NOTIONAL = 10000 // millions KRW, illustrative
const DF_START = 0.945 // illustrative DF at the start of the segment (1Y)

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function pct(r) {
  return `${(r * 100).toFixed(3)}%`
}

export function TelescopingDemo() {
  const [expanded, setExpanded] = useState(false)

  const segment = useMemo(() => {
    const steps = buildBootstrapSteps(DEMO_CD_RATE, DEMO_PAR_RATES)
    return steps.find((s) => s.label === '1Y–2Y')
  }, [])

  const periods = useMemo(() => {
    const dcf = 0.25
    let df = DF_START
    const rows = []
    for (let i = 0; i < segment.quarters; i++) {
      // DF built by compounding this exact forward rate -- this is what makes
      // the telescoping identity exact, not approximate.
      const nextDf = df / (1 + segment.rate * dcf)
      const pv = NOTIONAL * segment.rate * dcf * nextDf
      rows.push({ index: i, dcf, dfStart: df, dfEnd: nextDf, pv })
      df = nextDf
    }
    return rows
  }, [segment])

  const perPeriodSum = periods.reduce((acc, p) => acc + p.pv, 0)
  const dfFinal = periods[periods.length - 1].dfEnd
  const telescopingPv = NOTIONAL * (DF_START - dfFinal)
  const diff = Math.abs(perPeriodSum - telescopingPv)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground/90 leading-relaxed flex-1 pr-4">
          스프레드와 분할상환이 없는 바닐라 변동 레그의 경우, 각 기간의 선도금리를 하나씩 더한
          값과 텔레스코핑 단축 계산식{' '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded-sm">
            Notional × [DF(start) − DF(end)]
          </code>{' '}
          의 결과는 근사치가 아니라 <em>완전히 동일</em>합니다. 실제 운영 엔진
          (<code className="font-mono text-xs">mtm_valuation.py</code>)도 가능할 때마다 이
          최적화를 사용합니다.
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-xs font-semibold uppercase tracking-widest text-primary hover:underline"
        >
          {expanded ? '유도 과정 숨기기' : '유도 과정 보기'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            예시: {segment.label} 구간, flat forward 금리{' '}
            <span className="font-mono text-foreground">{pct(segment.rate)}</span>, 명목원금 ₩
            {fmt(NOTIONAL, 0)}M, 예시용 DF(1Y) ={' '}
            <span className="font-mono text-foreground">{fmt(DF_START, 4)}</span>에서 시작.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                기간별 합산
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>기간</TableHead>
                    <TableHead className="text-right">DF(end)</TableHead>
                    <TableHead className="text-right">PV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.map((p) => (
                    <TableRow key={p.index}>
                      <TableCell className="text-xs">Q{p.index + 1}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(p.dfEnd, 4)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(p.pv, 2)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="text-xs font-semibold">합계</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {fmt(perPeriodSum, 2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                텔레스코핑 단축 계산
              </div>
              <div className="rounded-sm border border-border px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DF(start)</span>
                  <span className="font-mono text-foreground">{fmt(DF_START, 4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DF(end)</span>
                  <span className="font-mono text-foreground">{fmt(dfFinal, 4)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">Notional × [DF(start) − DF(end)]</span>
                  <span className="font-mono font-semibold text-foreground">{fmt(telescopingPv, 2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={diff < 1e-6 ? 'positive' : 'negative'}>
              {diff < 1e-6 ? '정확히 일치' : `${fmt(diff, 6)}만큼 불일치`}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {fmt(perPeriodSum, 2)} vs {fmt(telescopingPv, 2)} — {periods.length}번의 개별 기간
              계산 대신 할인계수(DF) 조회 한 번으로 끝.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
