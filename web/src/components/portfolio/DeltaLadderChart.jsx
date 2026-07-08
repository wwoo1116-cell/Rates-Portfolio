import { cn } from '@/lib/utils'
import { fmt } from '@/lib/format'

// Diverging horizontal bar chart: one row per curve pillar (3M/1Y/2Y/... ),
// bars grow left (negative) or right (positive) from a shared zero-line so
// sign is legible from bar direction alone, not just color -- color is a
// second, redundant signal (positive/negative tokens), never the only one,
// per PRODUCT.md's accessibility section. No charting dependency: plain
// flex/CSS bars, consistent with the rest of the app's restrained, numbers-
// first surfaces (see DESIGN.md / PRODUCT.md anti-references on decoration).
export function DeltaLadderChart({ buckets, title }) {
  if (!buckets || buckets.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        델타 데이터가 없습니다.
      </div>
    )
  }

  const maxAbs = Math.max(...buckets.map((b) => Math.abs(b.delta)), 1e-9)

  return (
    <div className="space-y-2">
      {title && (
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </div>
      )}
      <div className="space-y-1">
        {buckets.map((b) => {
          const positive = b.delta >= 0
          const widthPct = (Math.abs(b.delta) / maxAbs) * 50
          return (
            <div key={b.pillar} className="grid grid-cols-[44px_1fr_110px] items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground text-right tabular-nums">
                {b.pillar}
              </span>
              <div className="relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className={cn(
                    'absolute inset-y-0 rounded-sm',
                    positive ? 'left-1/2 bg-positive/70' : 'right-1/2 bg-negative/70',
                  )}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span
                className={cn(
                  'text-xs font-mono tabular-nums text-right',
                  positive ? 'text-positive' : 'text-negative',
                )}
              >
                {positive ? '+' : ''}
                {fmt(b.delta)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
