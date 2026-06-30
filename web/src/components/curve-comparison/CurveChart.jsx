const VIEW_W = 640
const VIEW_H = 260
const PAD_L = 52
const PAD_R = 16
const PAD_T = 16
const PAD_B = 32

function pct(r) {
  return `${(r * 100).toFixed(2)}%`
}

// Dependency-free SVG line chart -- no charting library is used elsewhere in
// this project (the methodology page hand-rolls all its visuals as flex/CSS
// bars), so this follows the same convention rather than introducing one.
export function CurveChart({ series }) {
  const allPoints = series.flatMap((s) => s.points)
  if (allPoints.length === 0) return null

  const minRate = Math.min(...allPoints.map((p) => p.zero_rate))
  const maxRate = Math.max(...allPoints.map((p) => p.zero_rate))
  const rateRange = maxRate - minRate || 0.001
  const rateLo = minRate - rateRange * 0.15
  const rateHi = maxRate + rateRange * 0.15

  const xScale = (t) => PAD_L + (t / 10) * (VIEW_W - PAD_L - PAD_R)
  const yScale = (r) => VIEW_H - PAD_B - ((r - rateLo) / (rateHi - rateLo)) * (VIEW_H - PAD_T - PAD_B)

  const yTickCount = 5
  const yTicks = Array.from({ length: yTickCount }, (_, i) => rateLo + ((rateHi - rateLo) * i) / (yTickCount - 1))
  const xTicks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto" role="img" aria-label="CD 커브 zero rate 비교 차트">
      {yTicks.map((r) => (
        <g key={r}>
          <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={yScale(r)} y2={yScale(r)} className="stroke-border" strokeWidth="1" />
          <text x={PAD_L - 6} y={yScale(r)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[9px]">
            {pct(r)}
          </text>
        </g>
      ))}

      {xTicks.map((t) => (
        <g key={t}>
          <line x1={xScale(t)} x2={xScale(t)} y1={PAD_T} y2={VIEW_H - PAD_B} className="stroke-border" strokeWidth="0.5" opacity="0.5" />
          <text x={xScale(t)} y={VIEW_H - PAD_B + 14} textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {t}Y
          </text>
        </g>
      ))}

      {series.map((s) => (
        <g key={s.method}>
          <polyline
            points={s.points.map((p) => `${xScale(p.tenor_years)},${yScale(p.zero_rate)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
          />
          {s.points
            .filter((p) => p.is_knot)
            .map((p) => (
              <circle
                key={p.tenor_years}
                cx={xScale(p.tenor_years)}
                cy={yScale(p.zero_rate)}
                r="3.5"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth="1.5"
              >
                <title>
                  {s.label} · {p.tenor_years}Y · {pct(p.zero_rate)} (실제 시장 quote 지점)
                </title>
              </circle>
            ))}
        </g>
      ))}
    </svg>
  )
}
