# RECON2-RH — Session Report (lane B: M2 Δbp time series in range mode)

Session date: 2026-07-21. Worktree lane `wt-recon2-rh`, branch `recon2/rh-deltabp`, base
FE mainline `feat/simulation-migration` @ **2c0311f** (recon-v1). BE untouched (read-only,
e302593). **No build, no server contact, no push** — the merge mini-pass owns integration
and the only build+restart window. Worktree left in place, one commit: **a4462c8**.

Design authority followed: `C:\Users\infomax\recon2-design\RECON2_DESIGN.md` (T2).

## T0

- Worktree created off 2c0311f; `pnpm install`; tsc clean; eslint `npx eslint .` =
  **34 problems (13E/21W)** — matches the recon-v1 baseline. Full vitest deliberately NOT
  run at T0 (heavy-suite concurrency rule with lane A); the 345/0 baseline is the accepted
  RECON-VMP figure and is reconfirmed arithmetically at lane end (363 − 18 = 345).

## The change (one commit, a4462c8)

### 1. Retention, not recomputation (the design finding, executed)

`use-recon-range.ts` — the loop already computed the per-tenor Δbp map per day and
discarded it. The FULL functional diff of the hook (everything else is the docstring):

```diff
+  deltaBp?: Record<string, number | null>;   // on ReconRangeRow
 ...
-                residualPct: null, note: "KRD 합계 행 없음",
+                residualPct: null, note: "KRD 합계 행 없음", deltaBp,
-                residualPct: null, note: realized.disabledReason,
+                residualPct: null, note: realized.disabledReason, deltaBp,
-                residual: f.residual, residualPct: f.residualPct,
+                residual: f.residual, residualPct: f.residualPct, deltaBp,
```

No new call, no new fetch, no new cache: the three pushes are the three existing
window-matched sub-branches, each retaining the SAME object the one `deltaBpByTenor` call
produced (footer-disabled days included — Δbp is snapshot-derived and valid there). The
window-mismatch branch retains nothing: a Δbp there would measure a different window than
its label claims, so those days are whitespace downstream.

### 2. UI

- `recon-range-strip.tsx`: `[잔차 표] [Δbp 시계열]` toggle in the strip header (aria-pressed
  buttons, sem-info pressed recipe). Default = 잔차 표 (pre-existing view untouched).
  Toggling swaps table ↔ chart over the SAME computed rows — pinned to never refetch. The
  lazy prompt / 계산 / +20일 확장 / progress chrome is shared by both views.
- `recon-deltabp-chart.tsx` (new): canonical `SeriesChart`, `valueKind: "bp"` on every
  series (scale-formatter uniformity), `tooltip` + `zeroLine`. Owner ruling implemented:
  **all 16 pillars on by default**, series labeled in the day-offset vocabulary
  **D+1 / D+91 / D+182 / D+273 / D+1Y / D+18M / D+2Y … D+10Y / D+30Y** (91 = the CD91D
  convention; fixed lookup table, no parsing); chips are FILTERS on top of the all-on
  default, tenor-only (single-family data source — stated in the caption), last chip not
  deselectable; chips carry the same D+ labels with the KRD column as `title`.
- Calendar honesty (s15): continuous calendar axis from first to last reconciliation day;
  weekends/holidays, window-mismatch days, and unmapped pillars are **whitespace points**
  (`{time}` only), never zero; a measured 0.0bp is a value point at 0.0 (the 48a6b15
  zero-vs-unmapped rule carried into the series).

### 3. Legibility solution (16 concurrent series, no new hues)

Constraint: the master palette reserves no 16-hue ladder; the maturity ramp has exactly
3 steps; Jade/Berry are locked to signed P&L. Shipped solution, entirely within existing
tokens:

| Role | Token | Hex | Contrast basis |
|---|---|---|---|
| 단기 (<1Y: 1D/3M/6M/9M) | `--chart-maturity-short` | #187ABA | existing token — inside the S7 contrast gate's token sweep |
| 중기 (1–3Y: 1Y/1.5Y/2Y/3Y) | `--chart-maturity-mid` | #4695C8 | 〃 |
| 장기 (>3Y: 4Y…10Y/30Y) | `--chart-maturity-long` | #A3CAE3 | 〃 |
| Hover highlight (one tenor at a time) | `--chart-tangerine` | #D9822B | 〃 — the hue this app already uses for a second curve against blue; not a P&L hue |

Mechanics: every series draws at lineWidth 1 in its maturity-bucket color; hovering a
tenor chip re-colors THAT series Tangerine at lineWidth 3 (and restores on leave), so any
of the 16 can be isolated instantly without 16 reserved hues. Badge collision (s14):
16 series ≫ the badge limit, so only the 3Y series is `primary` — one badge, crosshair
tooltip for the rest. **Contrast evidence:** zero new colors were introduced — all four
hues are existing `--chart-*` tokens, and `scripts/check_chart_contrast.test.ts` sweeps
every `--chart-*` token vs `--bg-surface` (≥3:1 floor or documented allowlist); the gate
ran green in the final suite, which covers this surface structurally. The bucket→tenor
mapping and the token-only rule are additionally pinned in the chart tests (an off-palette
hue fails the test before it would fail the gate).

3Y sits in 중기 per the ramp's own comment (중기 1~3Y); the boundary choice is pinned.

## Pin enumeration (+18, all in a4462c8)

Hook (`use-recon-range.test.tsx`, new, 4):
1. **Same-object retention** — `rows[i].deltaBp` `toBe` (object identity) the i-th
   `deltaBpByTenor` spy RESULT; exactly 2 calls for 2 matched days.
2. Numeric parity — the retained map `toEqual` an independent invocation of the same pure
   function over the same snapshots (= what the single-date M2 row renders); mapped pillar
   +2.0bp, unmapped 1D null.
3. Footer-disabled day still retains Δbp (series is snapshot-derived).
4. Window-mismatch day retains NO Δbp.

Chart (`recon-deltabp-chart.test.tsx`, new, 7):
5. All-on default: 16 series, ids = TENOR_COLS, the full D+ label vector pinned, valueKind
   "bp" on every series.
6. Parity: point values are the retained `row.deltaBp` values (two spot dates/tenors).
7. Calendar honesty: 6-slot continuous axis; mismatch day, Saturday, Sunday whitespace;
   measured 0.0 = value point; unmapped 1D whitespace on every day.
8. Legibility: bucket→ramp mapping pinned per tenor; all colors ∈ the 3 ramp tokens;
   `primary` only on 3Y.
9. Hover: chip mouse-enter → Tangerine + width 3 on that tenor only; restore on leave;
   HIGHLIGHT_COLOR === CHART_SERIES_COLORS[3] (an existing hue, pinned).
10. Chips filter; last selected tenor cannot be removed.
11. Selector purity (`buildDeltaBpSeries`) — the exported pure function reads the rows'
    retained maps.

Strip (`recon-range-strip.test.tsx`, +3):
12. Default = 잔차 표 (pressed), chart absent, chart component not invoked.
13. Toggle swaps table→chart, passes the SAME rows array by reference, `run` NOT called
    (toggling never recomputes), heading follows the view.
14. Pre-run chart view = the shared lazy prompt; nothing drawn, nothing fetched.

Panel (`daily-recon-panel.test.tsx`, +1):
15. **Home mount unaffected** (range-mode-only surface): no Δbp toggle, no chart host, no
    D+ vocabulary on the single-date mount; the toggle exists on the RH (showRange) mount.
    All 12 pre-existing panel pins (closure footer, exclusions, naming, mount parity) pass
    unchanged — the byte-identity evidence for the Home mount.

Guard (`scripts/check_deltabp_reuse.test.ts`, new, 3):
16. `deltaBpByTenor` referenced ONLY at the frozen call-site set {lib/daily-recon-math.ts,
    hooks/use-daily-recon.ts, hooks/use-recon-range.ts} — a forked recomputation anywhere
    in src/ fails by name.
17. The chart consumes `.deltaBp` and contains no recon-math import, no API client, no
    snapshot fields, no ×10,000 bp arithmetic.
18. The strip touches neither the math nor the API either.

(The guard is source-level, so the chart's own docstring deliberately paraphrases the
forbidden identifiers — noted in the file.)

## Gates (final HEAD a4462c8)

| Gate | Result |
|---|---|
| tsc | clean |
| vitest | **363 passed / 0 failed (49 files)** = 345 (recon-v1 baseline) + 18 declared above |
| eslint (`npx eslint .`) | **34 problems = 13E / 21W** — equal to the baseline (0 added) |
| Guards | all green inside the suite — incl. the S7 contrast gate (token sweep covers every hue shipped; no new tokens) and the new Δbp reuse guard |
| Tree | clean; feature commit a4462c8 (+ this report as a docs commit) on `recon2/rh-deltabp` |
| Build / push / servers | none, none, untouched |

## Forbidden-surface proof (verbatim)

```
$ git diff --name-only 2c0311f..HEAD
.impeccable/hook.cache.json
scripts/check_deltabp_reuse.test.ts
src/features/home/daily-recon-panel.test.tsx
src/features/home/recon-deltabp-chart.test.tsx
src/features/home/recon-deltabp-chart.tsx
src/features/home/recon-range-strip.test.tsx
src/features/home/recon-range-strip.tsx
src/hooks/use-recon-range.test.tsx
src/hooks/use-recon-range.ts
```

Zero paths under the Simulation directory/family, the settlement-CF components
(`swap-cashflow-recon.*` untouched), the shock/request builder, or Results components.
(`.impeccable/hook.cache.json` is the project's design-hook cache, auto-updated by the
configured PostToolUse hook — the established per-commit rider.)

## Notes for the merge pass

- Branch `recon2/rh-deltabp`: feature commit **a4462c8** + a docs commit for this report;
  worktree left in place.
- Expected file intersection with lane A (RECON2-SIM): `.impeccable/hook.cache.json` only
  (the benign cache; take either side). Any other intersection is unexpected — lane A's
  mandate is the Simulation family, which this diff provably avoids.
- Post-merge live check (whoever owns the window): RH → 일별 대사 → range 계산 → toggle
  Δbp 시계열 → all-16 default with maturity-ramp colors, hover a chip → Tangerine
  highlight; weekend gaps and any 창 불일치 day visibly empty, CD 0.0bp days drawn at 0.
