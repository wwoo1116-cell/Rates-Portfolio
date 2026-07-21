# SESSION PROMPT — RECON2 (single lane): N1 anchor-tenor selection + N2 M2-Δbp time series

> DRAFT — integrator: fill in the two `<TBD-*>` fields from RECON-VMP's accepted report
> before dispatch. Design rationale and archaeology: `C:\Users\infomax\recon2-design\RECON2_DESIGN.md`
> (read it first; it contains the bake-in inventory and the conversion math).

## Mode & base

Single feature lane, directly on FE mainline. **Base = post-merge mainline head
`<TBD-FE-HEAD>`** (the head RECON-VMP's report records after merging `recon/scen`; verify
`git log --oneline -1` matches before starting). BE base `<TBD-BE-HEAD>` (expected e302593
unless RECON-VMP states otherwise) — **BE is read-only this session: both tasks are FE-only
by design; if you believe a BE change is needed, STOP and report instead.**

T0: record heads + fresh baselines verbatim (FE vitest, tsc, eslint — same-command
`npx eslint .`; note the error count, the standing rule is the approved error baseline from
the RECON-VMP report, compared same-command). **Do NOT hardcode expected totals from this
prompt — the merged baselines are whatever RECON-VMP's report established; express every
gate as "T0 baseline + N declared new tests".** Local commits, no push unless the owner's
standing closeout instruction says otherwise.

Doc note: the authoritative SIM2 contract document is `SIM2_REPORT.md` (SIM2_DESIGN.md does
not exist — do not go looking for it).

## Owner rulings applied (integrator: confirm these were actually ruled before dispatch)

- N1 = **option (a)**: FE-side re-expression; wire contract untouched.
- 테너 스프레드 stays defined **vs 3Y**; the anchor moves only the designed path/target.
- Degenerate anchor conversion (`|X − s_rel(τa)| < 0.5bp`) **blocks the run** with an honest
  validation message — never a silent trivial-path run.
- N2 mounts as a **view toggle inside the existing RH range strip** ([잔차 표] [Δbp 시계열]);
  tenor chips only (no family axis — single-family data source); default tenor selection:
  `<TBD-owner: 3Y alone | 1Y/3Y/5Y/10Y>`.

## N1 — anchor-tenor selection (국고 1Y / 3Y / 5Y / 10Y), FE re-expression

Core rule: the user designs target `X` bp, waypoints, and drag **on the selected anchor
pillar**; `buildSimulateRequest` converts to the byte-equivalent 3Y-anchored wire payload:

```
s_rel(τ)   = tenor-spread offset at τ from the generateShockCurves node formula (s_rel(3Y)=0)
base_wire  = X − s_rel(τa)
wp_wire.bp = wpAnchor.bp × (base_wire / X)
```

All other tenors/families keep deriving exactly as today (factor × terminal; family = base +
factor×spread). The engine, golden contract, s21 cache, SIM2-4 activation, and the lane-B
recon/path-matrix machinery consume the wire request and need **zero changes** — that is the
point of option (a).

Implementation constraints (from the design memo — cite it in code where it rules):
- `ScenarioParams.anchorTenor: "1Y" | "3Y" | "5Y" | "10Y"` (default "3Y"), same store/param
  semantics as every other scenario param. `baseShockBp` (the param) becomes the
  **anchor-native target**; only the wire value is converted.
- Conversion + the 0.5bp degeneracy guard live in `lib/scenario-curves.ts` (export
  `tenorSpreadAt` reusing the SAME node formula — no parallel spread math). Guard fires as a
  blocked run + visible reason, wired through the port's error surface, never a silent
  request.
- Configure: anchor SegmentedButtons in the 경로 section; the hard-coded 3Y copy goes
  dynamic (목표 변동 label + aria, 경로 설정 heading, header caption). The
  "국고채 테너 스프레드 (vs 국채 3Y)" caption **stays "vs 국채 3Y"** (ruling above).
- Preview (F2 surface): `ANCHOR_TENOR`/`ANCHOR_FAMILY` become params-driven — default
  selected chip = the anchor, markers/drag gate on the anchor series, captions dynamic.
  Drag/steppers/clamp already operate in anchor-bp units — do not touch lib/waypoints math.
- Results chip: anchor-native display ("국고 {anchor} 목표 변동 {X:+}bp") — reconstruct
  `X = base_wire + interp(국채 curve, τa)` from `lastRunRequest`; remember the run's anchor
  client-side next to `lastRunRequest` (it is deliberately NOT on the wire).
- `scenario-preview.ts` gov3y naming/labels: display-layer rename only; the lerp is already
  anchor-agnostic.

Pins (tests-first where they pin behavior):
1. **anchor=3Y byte-identity**: wire payload identical to pre-N1 for the default params
   (structural backward compat — the conversion is the identity at 3Y).
2. **Conversion exactness** (5Y and 10Y, nonzero spreads): the path-matrix evaluator's
   anchor-pillar row on the CONVERTED request equals the designed anchor path (round2), and
   the anchor terminal equals X; family/tenor derivation identities unchanged.
3. **Degeneracy guard**: anchor 10Y with X == spread10y → run blocked, no request built;
   message names the cause.
4. **Triviality preservation**: an exactly-linear anchor design converts to a trivial wire
   path (SIM2-4 stays in the legacy regime — assert via the activation predicate, not the
   engine).
5. F2 default-chip/drag re-pins with `[CHANGED, N1]` markers; existing SIM2-1/2-3 pins
   otherwise unchanged.
6. Results chip labeling pin.

Declare: N new tests + M re-pins, per commit.

## N2 — M2 Δbp time series in the RH range strip

Data rule (single-component rule, structural): `use-recon-range.ts` ALREADY computes
`deltaBpByTenor(...)` per day — **retain that exact object** on `ReconRangeRow`
(`deltaBp: Record<string, number|null>`); the chart consumes the retained map. No second
`deltaBpByTenor` call site, no new endpoints, no new fetches, no new caching (standing
mandate), lazy/sequential/incremental loop untouched.

UI: view toggle in the strip header ([잔차 표] [Δbp 시계열]); canonical `SeriesChart` with
`valueKind: "bp"`; tenor chips over the 16 `TENOR_COLS` in the F2 toggle-chip grammar
(default per ruling; last chip not deselectable); fixed per-tenor color map over
`CHART_SERIES_COLORS` (stable identity — selection order never recolors); badge policy:
`primary` on 3Y only, pills off. Calendar honesty: real-date axis, whitespace points for
weekends/holidays, for null (unmapped) tenor-days, and for window-mismatch excluded days —
**never a zero for an unknown**; a measured 0.0bp is a value point at 0.0 (the 48a6b15
zero-vs-unmapped rule).

Pins:
1. **Parity**: chart point at (D, τ) === retained `row.deltaBp[τ]` === `deltaBpByTenor`
   output for D's snapshots === the single-date M2 row value for D (same fixture).
2. Null → whitespace; measured 0.0 → value 0.0.
3. **Reuse guard** test (lane-A cashflow-guard pattern): fails on a second `deltaBpByTenor`
   call site or a local Δbp computation in the strip/chart.
4. Toggle/chips/color-map pins.

## Gates & finish

Per commit: tsc + targeted tests + count declaration ("T0 + N"). Lane end: full FE vitest
(expect T0 total + declared additions, 0 failed), `npx eslint .` errors ≤ the T0 error
baseline, all guard scripts green (they run inside vitest). BE: untouched — state
`git status` cleanliness and that no BE suites were owed.

Server rules (standing): the owner's servers may be RUNNING — zero server contact except ONE
authorized build+restart window at the end (kill-check before rebind; the BE 4-worker
listener-drop fragility is documented — if the BE dies under load, kill-check + restart
inside the window and record it). Heavy suites sequential, never concurrent with the build.
Live evidence after the restart: Configure with a non-3Y anchor (chips + drag on the anchor
series), a run's Results chip showing the anchor-native target, RH range strip in Δbp mode
with the honest whitespace where applicable.

Commits: `feat(sim): anchor-tenor selection (N1 core)` ·
`feat(sim): anchor-aware preview/drag (N1 surface)` ·
`feat(recon): M2 Δbp time series in range strip (N2)`.
Deliver `RECON2_REPORT.md` (T verdicts, gate arithmetic as "T0 + N", per-commit
`git show --stat` verbatim, owner-ruling confirmations, deviations).

## Out of scope
BE changes of any kind · new endpoints/caching · credit-family Δbp series (data source
doesn't carry it) · per-sector realized buckets (separate owner call) · bond cashflow recon ·
fan/ratePaths surface changes · quant_engine · pushing (unless the standing closeout says so).
