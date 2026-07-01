import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { fmt, fmtPct, pvBg } from '@/lib/format'

export function PortfolioCashFlowTable({ cashflows }) {
  if (!cashflows || cashflows.length === 0) {
    return <p className="text-sm text-muted-foreground">표시할 잔존 현금흐름이 없습니다.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>포지션</TableHead>
          <TableHead>기간</TableHead>
          <TableHead>레그</TableHead>
          <TableHead className="text-right">금리</TableHead>
          <TableHead>확정 여부</TableHead>
          <TableHead>지급일</TableHead>
          <TableHead className="text-right">PV (KRW)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cashflows.map((cf, i) => (
          <TableRow key={`${cf.position_id}-${i}`} className={pvBg(cf.pv)}>
            <TableCell>
              <Badge variant="outline">{cf.position_id}</Badge>
            </TableCell>
            <TableCell className="text-xs">
              {cf.accrual_start} → {cf.accrual_end}
            </TableCell>
            <TableCell className="text-xs">{cf.leg === 'fixed' ? '고정' : '변동'}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmtPct(cf.rate)}</TableCell>
            <TableCell className="text-xs">{cf.is_known ? '확정' : '추정'}</TableCell>
            <TableCell className="text-xs">{cf.payment_date}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmt(cf.pv)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
