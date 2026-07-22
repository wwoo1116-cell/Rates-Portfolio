# FB5-A — RH trace-date context · +1/−1 label removal · recon display follow-ups

Lane A of the FB5 two-lane pass. **Worktree only — nothing built, restarted, or
pushed.** Landing pass owns the single build+restart window.

## Base & environment (Step 0)

| Item | Value |
|---|---|
| FE repo | `krw-fi-pms` |
| Mainline | `feat/simulation-migration` |
| **Base head** | `0471ed4` (`docs(fb4): landing report — merge 6a530f1…`) |
| `fb4` ancestry | ✅ `git merge-base --is-ancestor fb4 HEAD` → fb4 IS ancestor (post-FB4-LAND line) |
| Worktree | `wt-fb5-rh` (fresh — created this session) |
| Branch | `fb5/rh-trace` (did **not** pre-exist — dual-dispatch guard clean) |
| **Lane head** | `d5ab339` |
| BE | v2 (dv01 line), read-only — used only to source `dv01_sources`/`blotter_as_of` semantics |

Dual-dispatch guard: branch was absent, no stray `wt-fb5-rh`, tree clean at base —
no shared worktree. Deps installed into the worktree via `pnpm install
--frozen-lockfile` (worktree ships without `node_modules`; lockfile untouched).

## Gates (re-derived from this checkout)

| Gate | Baseline @ 0471ed4 | After (d5ab339) |
|---|---|---|
| `tsc --noEmit` | clean | **clean** |
| `vitest run` | 423 / 56 files | **434 / 56 files** (+11 new, 0 broken) |
| `eslint` | 13 errors / 21 warnings | **13 / 21** (unchanged — all pre-existing in `api-client.ts`/`api-types.ts`) |
| tree | — | clean (12 files, committed; `.impeccable/hook.cache.json` reverted) |
| build / push | — | **not run** (landing pass) |

**Forbidden-surface proof** — `git diff --name-only 0471ed4..HEAD`:
```
src/features/home/daily-recon-panel.test.tsx
src/features/home/daily-recon-panel.tsx
src/features/home/pnl-trace-panel.test.tsx
src/features/home/pnl-trace-panel.tsx
src/features/home/rate-history-chart.tsx
src/features/home/recon-range-strip.test.tsx
src/features/home/recon-range-strip.tsx
src/features/rates-history/instrument-selector.test.tsx
src/features/rates-history/instrument-selector.tsx
src/lib/daily-recon-math.test.ts
src/lib/daily-recon-math.ts
src/lib/rv-instruments.ts
```
`grep -i simulation` over that list → **none**. Zero diffs under the Simulation
family (lane B's territory).

---

## A1 — Trace-date rate context (owner feedback ②)

When a date is traced from the Rate History chart, the PnL Trace panel's top
region (`Rate Context — {date}`) now shows:

1. **IRS 3Y / IRS 10Y benchmark pair** — always present, read straight from the
   clicked `point.tenor_rates` (`rateValue(point, "3Y"|"10Y")`). `data-testid=
   "trace-benchmark-rates"`.
2. **Every series that was on the chart** when the date was clicked, each at that
   date, with the series' own **label + color chip** and value in its native unit
   (outright → `%`, spread → `bp`). `data-testid="trace-series-context"`, one row
   per series at `trace-ctx-<id>`.

### Data-path statement (same-source, no new endpoint)
The chart already holds `builtSeries: BuiltSeries[]` (`buildInstrumentSeries` over
the loaded `/api/rate-history` + `/api/credit-curve` data). On a date-click,
`rate-history-chart.tsx` calls the new pure helper
**`traceSeriesContextAt(builtSeries, date)`** (in `rv-instruments.ts`), which reads
each series' value out of `BuiltSeries.lineData` at that date (missing point →
`null`), and passes the result in the dockview `addPanel` **params**
(`{ point, seriesContext }`). The panel renders those values verbatim — **no
re-fetch**. A series with no quote that day renders an honest `—` (never a stale
carry-forward, because `lineData` simply has no point for that date).

`seriesContext` is **optional** (defaults to `[]`) — panels opened without chart
context (older detach state, the two existing test suites) still render the
benchmark pair.

### Pin
`pnl-trace-panel.test.tsx › A1 traced-date rate context (same-source)` — 3 tests:
builds series via the **same** `buildInstrumentSeries`, derives context via
`traceSeriesContextAt`, renders the panel, and asserts the context row's value
**equals the built series' `lineData` value at that date** (outright 3.0500%,
spread 37.00bp) and a quoteless 5Y series renders `—`.

---

## A2 — Remove the +1/−1 coefficient labels (F3 follow-up, owner-ruled)

`instrument-selector.tsx` — `SpreadLegRow` no longer renders the read-only
coefficient `<span>` (`+1`/`-1`) or the `×` glyph; the `weight` prop was dropped
from `SpreadLegRowProps`. A leg row now reads as the instrument alone; the chip
label (`국고채 3M − 국고채 3M`, `spreadLabel`) is unchanged.

**Fixed coefficients stay internal & byte-identical**: `DEFAULT_SPREAD_WEIGHTS`
still feeds `handleAddSpread` — the reference-level pin
(`Add Spread emits … the weight-encoded id`, `S:1*IRS||3Y~-1*IRS||3Y` /
`…~-2*…~1*…`) stays green.

### Pins
`instrument-selector.test.tsx` — the two ex-"shows +1/−1" tests are now
**label-absence pins**: no `aria-label=/coefficient/i` element, no `"+1"`/`"-1"`
(2-leg) or `"+2"` (3-leg) text on the builder surface. The two weight-emission
pins are untouched and green.

### Selector-API stability (lane B note)
`InstrumentSelectorProps` (`taxonomy` / `selected` / `onAdd` / `onRemove`) and the
exported `InstrumentSelector` component are **unchanged** — only the private inner
`SpreadLegRow` was edited. Lane B's import of the shared selector is safe; no
interface change, no STOP needed.

---

## A3 — Recon display follow-ups (display text only; no math changes)

All on the shared `daily-recon-panel.tsx` (mounted on Home + Rates History) plus
the range strip. Sourced from the BE's live `dv01_sources` semantics
(`portfolio_analytics_service.build_pvbp_sensitivity`; keys `reval` / `sheet_frn`
/ `sheet_fallback`).

1. **Stale caption fix.** The false "채권 KRD는 블로터의 정적 PVBP…" sentence is
   rewritten to the post-DV01 reality: *고정쿠폰 채권 = D−1 커브 서버 재평가(reval
   DV01), FRN = 리셋 연동 시트 듀레이션, 재평가 불가 행 = 시트 PVBP(fallback), IRS =
   D−1 재평가.*
2. **as-of notice.** `blotter_as_of` surfaced as a `sem-risk`-toned chip
   (`data-testid="blotter-asof-chip"`), **only when stale** — `isBlotterStale`
   compares it to the priced close (`resolvedClose`) with a documented
   `BLOTTER_STALE_THRESHOLD_DAYS = 7`; a fresh export (as-of ≈ close) hides it.
3. **Mixed-basis chip.** `dv01_sources` counts rendered explicitly
   (`data-testid="dv01-sources-chip"`), e.g. `혼합 근거 reval 40 · FRN 3 ·
   fallback 2`, ordered reval → FRN → fallback (`DV01_SOURCE_ORDER`/`_LABELS`).
4. **M3 honest-zero.** `contributionRows` now returns `null` for a cell with **no
   KRD mass** (as well as unmapped Δbp), and a numeric **0** for a cell with KRD
   present and Δbp exactly `0.0` (the JS `−0` is normalized). The M3 grid passes
   `zeroAsDash={false}`, so an honest ₩0 renders `0` while `—` stays reserved for
   unmapped/no-KRD. **Σ / Assumed unchanged** (0-mass cells contribute 0 either
   way — pinned).
5. **Range-table % guard.** `recon-range-strip.tsx`: when `|예상|` (`r.expected`)
   is below the documented floor **`RANGE_PCT_EXPECTED_FLOOR_KRW = ₩1,000,000`**,
   the `%` column shows `—` with tooltip `예상 소액 — %가 왜곡됨` instead of a
   `−2459.5%`-style blowup. **Absolute 잔차 (its own column) is untouched**, and
   `bridgeLadder.residualPct` math is unchanged (display-only guard). *Note: the
   existing `−750.0%` pin (예상 = 1.7M, above the floor) stays green — the floor
   sits below it by construction.*

### Pins
- `daily-recon-math.test.ts`: contribution honest-zero vs no-KRD vs unmapped;
  `dv01Meta` (counts / as-of / FRN count + graceful degrade); `isBlotterStale`
  (frozen 2026-03-23 stale vs fresh/null).
- `daily-recon-panel.test.tsx`: A3.2/A3.3 chips render with a stale blotter; a
  fresh blotter hides the as-of chip but keeps the basis chip; A3.4 M3 renders
  `0` for KRD+Δbp-0.0 and `—` for no-KRD/unmapped.
- `recon-range-strip.test.tsx`: A3.5 %-guard (`—` + tooltip when 예상 < floor;
  absolute 잔차 retained; no `2459.5` blowup).

---

## Test enumeration (+11 over 423 → 434)

| File | New tests |
|---|---|
| `pnl-trace-panel.test.tsx` (A1) | 3 (benchmark pair, same-source equality, quoteless `—`) |
| `daily-recon-math.test.ts` (A3) | 4 (contribution honest-zero, dv01Meta ×2, isBlotterStale) |
| `daily-recon-panel.test.tsx` (A3) | 3 (stale chips, fresh hides as-of, M3 honest-zero) |
| `recon-range-strip.test.tsx` (A3.5) | 1 (%-guard) |
| `instrument-selector.test.tsx` (A2) | 0 net (2 rewritten in place → label-absence) |

## Handoff to the landing pass
- Branch `fb5/rh-trace` @ `d5ab339`, worktree `wt-fb5-rh` left in place.
- Selector public API stable — safe to integrate alongside lane B.
- No build / no restart / no push performed.
