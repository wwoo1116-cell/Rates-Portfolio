const VIEW_W = 640
const VIEW_H = 240
const PAD_L = 56
const PAD_R = 12
const PAD_T = 12
const PAD_B = 28
const Y_TICKS = 4

export function HistoricalPnlChart({ points }) {
  if (!points || points.length === 0) return null

  const allValues = points.flatMap((p) => [p.net_npv, p.cumulative_pnl])
  const minV = Math.min(0, ...allValues)
  const maxV = Math.max(0, ...allValues)
  const span = maxV - minV || 1

  const xScale = (i) => PAD_L + (i / Math.max(points.length - 1, 1)) * (VIEW_W - PAD_L - PAD_R)
  const yScale = (v) => VIEW_H - PAD_B - ((v - minV) / span) * (VIEW_H - PAD_T - PAD_B)

  const linePath = (key) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p[key])}`).join(' ')

  const tickValues = Array.from({ length: Y_TICKS + 1 }, (_, i) => minV + (span * i) / Y_TICKS)

  const xTickCount = Math.min(5, points.length)
  const xTickIdxs = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i * (points.length - 1)) / Math.max(xTickCount - 1, 1)),
  )

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto">
      {tickValues.map((v) => (
        <g key={v}>
          <line
            x1={PAD_L}
            x2={VIEW_W - PAD_R}
            y1={yScale(v)}
            y2={yScale(v)}
            className={v === 0 ? 'stroke-border' : 'stroke-border/50'}
            strokeWidth="1"
          />
          <text
            x={PAD_L - 8}
            y={yScale(v)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px] font-mono tabular-nums"
          >
            {(v / 1e8).toFixed(1)}억
          </text>
        </g>
      ))}

      {xTickIdxs.map((i) => (
        <text
          key={i}
          x={xScale(i)}
          y={VIEW_H - PAD_B + 16}
          textAnchor="middle"
          className="fill-muted-foreground text-[9px] font-mono tabular-nums"
        >
          {points[i].valuation_date.slice(5)}
        </text>
      ))}

      <path d={linePath('net_npv')} fill="none" className="stroke-primary" strokeWidth="1.5" />
      <path d={linePath('cumulative_pnl')} fill="none" className="stroke-positive" strokeWidth="1.5" />
    </svg>
  )
}
