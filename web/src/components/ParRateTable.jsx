import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

const TENORS = ['1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '9Y', '10Y']

export function ParRateTable({ cdRate, quotes }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>시장 데이터</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-4 flex items-center justify-between rounded-sm bg-muted px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">CD 91D</span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {cdRate ? `${(Number(cdRate) * 100).toFixed(4)}%` : '—'}
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>테너</TableHead>
              <TableHead className="text-right">Par rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TENORS.map((tenor) => {
              const q = quotes?.find((r) => r.tenor === tenor)
              return (
                <TableRow key={tenor}>
                  <TableCell className="font-medium">{tenor}</TableCell>
                  <TableCell className="text-right font-mono">
                    {q ? `${(Number(q.rate) * 100).toFixed(4)}%` : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
