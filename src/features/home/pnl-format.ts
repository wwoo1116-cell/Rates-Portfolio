/**
 * Shared P&L amount formatter for the Home/Rates-History panels: rounded (not
 * truncated) to the nearest 10,000 KRW, locale-grouped, and deliberately
 * suffix-free -- call sites append their own unit ("KRW", "KRW/bp").
 *
 * NOT the same as lib/format.ts's formatKrw, which truncates (만원 절삭) and
 * bakes in a " KRW" suffix. This existed as three identical private copies
 * (pnl-trace-panel, spread-position-panel, spread-pnl-chart), one of them
 * name-shadowing the lib function; folding it INTO lib/format.ts is the right
 * end state, deferred only because that file is mid-edit on another
 * workstream and staging it would sweep their uncommitted changes into our
 * commit.
 */
export function formatPnlKrw(value: number): string {
  return (Math.round(value / 10_000) * 10_000).toLocaleString();
}
