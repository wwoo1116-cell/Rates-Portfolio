/**
 * Full-digit P&L amount formatter: rounded (not truncated) to the nearest
 * 10,000 KRW, locale-grouped, and deliberately suffix-free -- call sites
 * append their own unit ("KRW", "KRW/bp").
 *
 * NOT the same as lib/format.ts's formatKrw, which truncates (만원 절삭) and
 * bakes in a " KRW" suffix.
 *
 * s14 scope note: TABLE/READOUT surfaces only (spread-position-panel's PVBP
 * legs + residual). Chart surfaces -- axis ticks, last-value badges, marker
 * text, chart tooltips -- must use the signed 억/만 formatter instead
 * (formatKrwAxisSigned, the SeriesChart valueKind "krw" default); the owner
 * directive bans full-digit/raw-float KRW anywhere on a chart.
 */
export function formatPnlKrw(value: number): string {
  return (Math.round(value / 10_000) * 10_000).toLocaleString();
}
