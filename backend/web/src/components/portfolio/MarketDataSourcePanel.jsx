import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// Required tenor list for the CCP discount curve grid, top-to-bottom in this
// exact order -- 1D stands in for the short deposit rate (cd_rate), the rest
// map to swap_quotes wherever the backend can represent them (whole years).
export const CCP_TENORS = [
  '1D', '3M', '6M', '9M', '1Y', '1.5Y', '2Y', '3Y', '4Y', '5Y',
  '6Y', '7Y', '8Y', '9Y', '10Y', '12Y', '15Y', '20Y',
]

export function createCcpCurveRows() {
  return CCP_TENORS.map((tenor) => ({ tenor, curveName: '', rate: '' }))
}

function GridInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      step={type === 'number' ? '0.0001' : undefined}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="flex h-8 w-full border-0 border-b border-transparent bg-transparent px-2 text-xs text-foreground placeholder:text-muted-foreground hover:border-border focus:outline-none focus:border-primary"
    />
  )
}

export function MarketDataSourcePanel({ dataSource, onDataSourceChange, ccpCurveRows, onCcpRowChange }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label className="shrink-0">시장 데이터 소스</Label>
        <div className="flex gap-1">
          {[
            ['true', 'True Data'],
            ['ccp', 'CCP Data'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onDataSourceChange(value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors',
                dataSource === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {dataSource === 'ccp' && (
        <div className="space-y-2 rounded-sm bg-muted/40 p-3">
          <p className="text-[11px] text-muted-foreground">
            CCP에서 받은 할인곡선을 만기별로 직접 입력하세요. 1D는 익일물(O/N) 예치금리, 3M은 단기
            예치금리(CD)로 커브에 반영되며, 나머지는 각 만기의 스왑 금리로 사용됩니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 px-2 font-semibold">곡선명</th>
                  <th className="pb-2 px-2 font-semibold w-16">만기</th>
                  <th className="pb-2 px-2 font-semibold">금리 (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ccpCurveRows.map((row, i) => (
                  <tr key={row.tenor}>
                    <td className="py-1 px-2">
                      <GridInput
                        value={row.curveName}
                        onChange={(e) => onCcpRowChange(i, 'curveName', e.target.value)}
                        placeholder="예: KRW IRS PAR_CCP"
                      />
                    </td>
                    <td className="py-1 px-2 text-xs font-medium text-muted-foreground w-16">{row.tenor}</td>
                    <td className="py-1 px-2">
                      <GridInput
                        type="number"
                        value={row.rate}
                        onChange={(e) => onCcpRowChange(i, 'rate', e.target.value)}
                        placeholder="예: 3.5039"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
