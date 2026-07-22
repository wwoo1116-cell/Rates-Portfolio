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

### The fix (commit 49fcea3, after the diagnosis commit 9d89b2c)

Liveness gate: `onChartReady` records the live chart in `liveChartRef` synchronously
(before the state update lands); the data effect bails unless
`traceChart === liveChartRef.current` — the stale post-remount run is skipped and the
queued `setTraceChart` re-render attaches the series to the live chart. The crosshair
unsubscribe cleanup is disposal-safe (try/catch). No behavior change on the normal
path; the ChartFrame-maximize path is unaffected (it was already safe).

**Pin** (`pnl-trace-panel.flow.test.tsx`, separate from the S9 suite which stubs
LwChartBase): real LwChartBase over a faked lightweight-charts that records
disposed-chart writes. 3 tests — initial render; the condition-change round trip
(latest chart carries the new series, zero disposed-chart attaches, header updated);
repeated changes. **Revert-verified: 2/3 fail with the fix stashed** (initial-mount
passes, both round-trip pins fail) — fails on revert as mandated.

## T2 / F3 — spread weights removed (commit 5886693)

**Before**: each spread leg had a signed numeric weight input (`Leg N weight`), raw
string state, validity gating on Add, and a weight-sum ≠ 0 warning.
**After**: coefficients are FIXED by leg count — 2-leg **+1/−1**, 3-leg fly
**+1/−2/+1** (exactly the previous defaults, `DEFAULT_SPREAD_WEIGHTS`) — rendered as
read-only labels; inputs, weight state, validation and the warning (unreachable: both
sets sum 0, so PVBP-neutral sizing always satisfiable) are gone. `Add Spread` emits
the canonical weights and the weight-encoded id. The selector is shared with the
entry-signals configure surface, which inherits the same fixed semantics.

- **No engine/data change**: `SpreadLeg.weight`, the sizing math
  (`lib/math/pvbp-sizing`), and the series math (`rv-instruments`) are untouched — a
  canonical spread's computed series is byte-identical by construction, and the pin is
  the strongest available form: `normalizeInstrumentV1(canonical)` returns the **same
  object reference**.
- **Persisted state normalized on load (noted as mandated)**: the entry-signals
  watchlist (persist v1) is the one store that can hold user-typed weights →
  **v1→v2 migration**: non-default spread weights normalize to the canonical set for
  their leg count (leg ORDER preserved — the sign pattern is positional), id
  re-derived (weights are encoded in it; the known one-time colorForId shift, same as
  the v0→v1 note). Outrights, null, and leg counts with no canonical set (unreachable
  via any shipped UI) pass through untouched — never guessed.

## Gates (final head 5886693)

| Gate | Result |
|---|---|
| tsc | clean |
| vitest | **397 passed / 0 failed** — baseline re-derived from this checkout's base (b5b4cac = 385, the recon2-merge count) **+ N = 12**, enumerated: +3 F1 flow pins (`pnl-trace-panel.flow.test.tsx`) · +5 F3 selector pins (`instrument-selector.test.tsx`: no inputs / 2-leg labels / fly labels / canonical 2-leg emission+id / fly emission+id + warning-gone) · +4 F3 normalization pins (`entry-signals-store.test.ts`: reference-identity, 2-leg, fly, passthrough) |
| eslint | **13E / 21W** (= ≤13E/21W gate) |
| guards | all green in-suite (incl. anti-fork, Δbp reuse — no comments naming its guarded identifiers were added) |
| tree | clean; NO build, NO push, servers untouched |
| forbidden surfaces | `git diff --name-only b5b4cac..HEAD` = hook cache, this report, `pnl-trace-panel(.flow.test)`, `instrument-selector(+test)`, `entry-signals-store(+test)` — **zero diffs** on Simulation, home recon files, `use-recon-range`, the shock builder, BE, or lane B's stylesheet. (`pnl-trace-panel` is a features/home file but NOT a recon file — it is F1's explicitly-assigned subject.) |

## Deferred

- Migrating PnL Trace onto the canonical SeriesChart (retires the hand-rolled wiring
  class entirely; requires re-homing the custom Delta/Daily/Cumulative/Funding
  tooltip) — cleanup-pass candidate.
- The entry-signals ES tab shares the fixed-coefficient selector; its own report/docs
  copy referencing "signed-weight legs" wording could be refreshed in a docs pass.

Worktree left in place for the merge pass.
