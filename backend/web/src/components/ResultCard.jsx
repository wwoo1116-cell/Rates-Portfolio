import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fmt, fmtPct, fmtEok, pvBg } from '@/lib/format'

export function ResultCard({ result }) {
  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>결과</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">스왑 조건을 입력하고 계산하면 결과가 표시됩니다.</p>
        </CardContent>
      </Card>
    )
  }

  // MTM revaluation responses carry dirty_npv; new-trade pricing responses don't.
  if ('dirty_npv' in result) {
    return <MtmResultCard result={result} />
  }

  const npv = Number(result.npv)
  const npvVariant = npv > 0 ? 'positive' : npv < 0 ? 'negative' : 'outline'

  return (
    <Card>
      <CardHeader>
        <CardTitle>결과</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">NPV</span>
          <div className="text-right">
            <Badge variant={npvVariant}>
              {npv >= 0 ? '+' : ''}{fmt(npv)} KRW
            </Badge>
            <div className="text-[11px] text-muted-foreground font-mono tabular-nums mt-0.5">{fmtEok(npv)}</div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">고정 레그 PV</span>
            <div className="text-right">
              <div className="font-mono tabular-nums text-foreground">{fmt(result.fixed_leg_pv)} KRW</div>
              <div className="text-[11px] text-muted-foreground font-mono tabular-nums">{fmtEok(result.fixed_leg_pv)}</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">변동 레그 PV</span>
            <div className="text-right">
              <div className="font-mono tabular-nums text-foreground">{fmt(result.float_leg_pv)} KRW</div>
              <div className="text-[11px] text-muted-foreground font-mono tabular-nums">{fmtEok(result.float_leg_pv)}</div>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Par rate</span>
            <span className="font-mono tabular-nums font-medium text-foreground">{fmtPct(result.par_rate)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">DV01</span>
            <span className="font-mono tabular-nums text-foreground">{fmt(result.dv01)} KRW/bp</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MtmResultCard({ result }) {
  const [showCashflows, setShowCashflows] = useState(false)

  const cleanNpv = Number(result.clean_npv)
  const dirtyNpv = Number(result.dirty_npv)

  return (
    <Card>
      <CardHeader>
        <CardTitle>MTM 재평가</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className={cn('flex items-center justify-between rounded-sm px-2 py-1.5', pvBg(cleanNpv))}>
          <span className="text-sm font-medium text-foreground">Clean NPV</span>
          <div className="text-right">
            <div className="font-mono tabular-nums font-semibold text-foreground">
              {cleanNpv >= 0 ? '+' : ''}{fmt(cleanNpv)} KRW
            </div>
            <div className="text-[11px] text-muted-foreground font-mono tabular-nums">{fmtEok(cleanNpv)}</div>
          </div>
        </div>
        <div className={cn('flex items-center justify-between rounded-sm px-2 py-1.5 text-sm', pvBg(dirtyNpv))}>
          <span className="text-foreground">Dirty NPV</span>
          <div className="text-right">
            <div className="font-mono tabular-nums text-foreground">
              {dirtyNpv >= 0 ? '+' : ''}{fmt(dirtyNpv)} KRW
            </div>
            <div className="text-[11px] text-muted-foreground font-mono tabular-nums">{fmtEok(dirtyNpv)}</div>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">경과이자</span>
          <span className="font-mono tabular-nums text-foreground">{fmt(result.accrued_interest)} KRW</span>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className={cn('flex items-center justify-between rounded-sm px-2 py-1.5 text-sm', pvBg(result.pv_fixed_leg))}>
            <span className="text-foreground">고정 레그 PV</span>
            <span className="font-mono tabular-nums text-foreground">{fmt(result.pv_fixed_leg)} KRW</span>
          </div>
          <div className={cn('flex items-center justify-between rounded-sm px-2 py-1.5 text-sm', pvBg(result.pv_floating_leg))}>
            <span className="text-foreground">변동 레그 PV</span>
            <span className="font-mono tabular-nums text-foreground">{fmt(result.pv_floating_leg)} KRW</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">텔레스코핑 교차검증</span>
            <Badge variant={!result.telescoping_used ? 'outline' : result.telescoping_diverged ? 'negative' : 'default'}>
              {!result.telescoping_used ? '해당없음' : result.telescoping_diverged ? '불일치 ⚠' : '일치'}
            </Badge>
          </div>
        </div>

        <Separator />

        <button
          type="button"
          onClick={() => setShowCashflows((v) => !v)}
          className="text-xs font-semibold uppercase tracking-widest text-primary hover:underline"
        >
          잔존 현금흐름 {showCashflows ? '숨기기' : '보기'} ({result.cashflows.length})
        </button>

        {showCashflows && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>기간</TableHead>
                <TableHead>레그</TableHead>
                <TableHead className="text-right">금리</TableHead>
                <TableHead>확정 여부</TableHead>
                <TableHead className="text-right">PV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.cashflows.map((cf, i) => (
                <TableRow key={i} className={pvBg(cf.pv)}>
                  <TableCell className="text-xs">
                    {cf.accrual_start} → {cf.accrual_end}
                  </TableCell>
                  <TableCell className="text-xs">{cf.leg === 'fixed' ? '고정' : '변동'}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-xs">{fmtPct(cf.rate)}</TableCell>
                  <TableCell className="text-xs">{cf.is_known ? '확정' : '추정'}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-xs">{fmt(cf.pv)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
