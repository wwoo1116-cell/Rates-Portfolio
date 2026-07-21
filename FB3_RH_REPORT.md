# FB3_RH_REPORT — lane A: F1 chart disappearance + F3 spread weights

2026-07-21. Worktree `wt-fb3-rh`, branch `fb3/rh-fixes`, base **b5b4cac** (recon-v2 line).
No build, no push, no server contact. Worktree left for the merge pass.

## T1 / F1 — chart disappears on condition change

### Root cause (diagnosed before the fix; this section committed first)

**Host: `features/home/pnl-trace-panel.tsx` — a stale-disposed-chart race on the
data-arrival remount.** Mechanism, step by step:

1. The chart block renders conditionally: `{npvTrace.data && ( … <LwChartBase
   onChartReady={(chart) => { setTraceChart(chart); traceSeriesRef.current = null; }} /> … )}`.
   `npvTrace` is a TanStack **useMutation** — calling `mutate()` again RESETS `data` to
   `undefined` for the duration of the new request (the panel's own error-state comment
   even relies on this).
2. Changing any condition (dates/rate/notional/direction) re-fires the auto-trace
   effect → `mutate()` → `data` momentarily `undefined` → **the chart block unmounts**
   and `LwChartBase`'s cleanup disposes the chart (`chart.remove()`). The
   `traceChart` STATE, living in the panel (which never unmounted), still holds the
   disposed instance.
3. New data arrives → the block remounts. In that commit, child effects run first:
   the new chart is created and `onChartReady` resets `traceSeriesRef` and QUEUES
   `setTraceChart(newChart)` — a state update that cannot apply until the next render.
   Then the panel's data effect (deps `[npvTrace.data, traceChart]`) runs — `data`
   changed, so it runs NOW, with the **old disposed chart from its closure**: it calls
   `addSeries` on the dead chart and stores that orphan handle in `traceSeriesRef`.
4. The queued `setTraceChart(newChart)` lands, the effect re-runs — but
   `traceSeriesRef.current` is now non-null, so it takes the update path and
   `setData`s the **orphan series belonging to the disposed chart**. The visible
   (new) chart never receives a series.

Result: an alive, empty chart pane (TradingView attribution only) while the numeric
header — plain DOM driven by the same new data — updates. Exactly the owner's
screenshot.

Why s10's "onChartReady ref-reset" pattern didn't save it: it protects the
ChartFrame-maximize remount, where `data` is UNCHANGED in the remount commit (the
effect doesn't fire against the stale chart; it waits for `setTraceChart`). The
data-arrival remount is the one case where `data` changes in the SAME commit that
remounted the chart — the effect fires one render too early.

### Per-host sweep (every chart host reachable in the Rates History tab)

| Host | Wiring | Verdict |
|---|---|---|
| `pnl-trace-panel.tsx` | hand-rolled LwChartBase + `useState<IChartApi>` + conditional block on MUTATION data | **ROOT CAUSE — fixed this lane** (liveness gate, below) |
| `rate-history-chart.tsx` | canonical `SeriesChart` (no chart state held by the host) | SAFE — SeriesChart's chart/series/`prevIds` refs are instance-local; any remount recreates them together, and its diff effect always runs on first commit |
| `spread-position-panel.tsx` → `spread-pnl-chart.tsx` | canonical `SeriesChart` (s14 migration) behind a `pnlPath.length > 0` conditional | SAFE — a conditional remount remounts the whole SeriesChart instance (self-healing); no external chart state exists to go stale |
| `recon-deltabp-chart.tsx` (lane B's file — READ-ONLY pattern check, zero diffs) | canonical `SeriesChart` | SAFE — same argument; verdict recorded here, file untouched |
| `daily-recon-panel` / matrices / strip table | not chart hosts (DOM tables) | n/a |

The fix (next commit): a **liveness gate** — `onChartReady` records the live chart in a
ref synchronously; the data effect bails unless `traceChart === liveChartRef.current`
(a stale run is exactly "a `setTraceChart` re-render is already queued; let the effect
re-run with the live chart"), plus a disposal-safe crosshair unsubscribe. The
architectural alternative (migrating PnL Trace onto SeriesChart like s14 did for
spread) is ledgered for a cleanup pass — it would retire this wiring class entirely
but rewrites the custom Delta/Daily/Cumulative/Funding tooltip, out of a fix lane's
proportion.

<!-- F1-FIX, T2, gates: filled by later commits -->
