import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { fmtRate4 } from '@/lib/format'
import { quoteLabel } from '@/lib/tenorQuote'

export function HistoricalSnapshotView({ snapshot, loading, error }) {
  if (loading) return <p className="text-xs text-muted-foreground">로딩 중…</p>
  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (!snapshot) return <p className="text-xs text-muted-foreground">날짜를 선택하세요.</p>

  const { marketData, curve } = snapshot

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border border-border p-2.5">
          <div className="text-[11px] uppercase text-muted-foreground">CD 91D</div>
          <div className="font-semibold tabular-nums">{fmtRate4(marketData.cd_rate)}%</div>
        </div>
        {marketData.on_rate != null && (
          <div className="rounded-md border border-border p-2.5">
            <div className="text-[11px] uppercase text-muted-foreground">O/N (Call)</div>
            <div className="font-semibold tabular-nums">{fmtRate4(marketData.on_rate)}%</div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">고시 금리 (Par Quotes)</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenor</TableHead>
              <TableHead>Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {marketData.swap_quotes.map((q) => (
              <TableRow key={quoteLabel(q)}>
                <TableCell>{quoteLabel(q)}</TableCell>
                <TableCell className="tabular-nums">{fmtRate4(q.rate)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <div className="mb-1 text-[11px] text-muted-foreground">부트스트랩 커브 (Knot Points)</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenor (Y)</TableHead>
              <TableHead>Zero Rate</TableHead>
              <TableHead>Discount Factor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {curve.points
              .filter((p) => p.is_knot)
              .map((p) => (
                <TableRow key={p.tenor_years}>
                  <TableCell className="tabular-nums">{p.tenor_years.toFixed(2)}</TableCell>
                  <TableCell className="tabular-nums">{fmtRate4(p.zero_rate)}%</TableCell>
                  <TableCell className="tabular-nums">{p.discount_factor.toFixed(6)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
