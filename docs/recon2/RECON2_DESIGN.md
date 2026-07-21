# RECON2_DESIGN — N1 anchor-tenor selection + N2 M2-Δbp time series

Read-only design session, 2026-07-21. Sources read at immutable refs only: FE mainline
**48a6b15**, BE **e302593**, lane-B branch `recon/scen` @ **e756ad5** (via `git show` — the
worktree's working files were being manipulated by the concurrent RECON-VMP session and were
not trusted). Nothing was written to any repo; no servers, no suites.

Doc note: the session brief cites **SIM2_DESIGN.md — that file does not exist**. The actual
contract document is `krw-fi-pms/SIM2_REPORT.md`; every invariant cited below was verified
there and in code.

---

## T1 — N1: selectable anchor tenor (국고 1Y / 3Y / 5Y / 10Y)

### 1. The shock contract today — where "3Y" actually lives

The single most important finding: **the backend has no 3Y anchor concept in its math.** The
anchor lives entirely in how the FE *constructs* the request:

**FE (mainline 48a6b15, `src/features/simulation/`):**

| Site | What is 3Y-baked |
|---|---|
| `lib/scenario-curves.ts::generateShockCurves` | The pivot itself: node `{t: 3, s: 0}` — tenor spreads are offsets **relative to 3Y**, so the 국채 curve's 3Y value ≡ `baseShockBp`. This one line is what makes 3Y "the anchor". |
| `lib/scenario-curves.ts::buildSimulateRequest` | `baseShockBp` = the 3Y terminal, `customPath` waypoints = the 3Y cumulative-bp path (calendar-day lerp, flat extrapolation, terminal pin `{simDays, baseShockBp}` — SIM2-2). |
| `lib/scenario-preview.ts` | `gov3y` naming + doc ("국채 3Y bp path"); the lerp itself is anchor-agnostic. |
| `lib/waypoints.ts` | Clamp/snap/lerp-default operate in "anchor bp" units (currently 3Y bp); math is anchor-agnostic. |
| `components/stages/configure-stage.tsx:243,268,276,299,348` | Copy: "국채 3Y 기준 금리 경로 설계", label+aria "국채 3Y 목표 변동", "경로 설정 (국채 3Y 웨이포인트)", "국고채 테너 스프레드 (vs 국채 3Y)". |
| `components/panels/curve-view-panel.tsx:15,105,120,199` | 시계열형 draws the `gov3y` series; caption "국채 3Y 경로". |
| `components/stages/results-stage.tsx:56` | "목표 변동" chip prints `lastRunRequest.baseShockBp` — i.e. the 3Y terminal. |
| `api/simulate-dto.ts:103` | Doc: `distribution.ratePaths` = "each scenario's 국채 3Y cumulative-bp path". |

**Lane B additions (`recon/scen` @ e756ad5):**

| Site | What is 3Y-baked |
|---|---|
| `curve-view-panel.tsx:77-78` (F2 rework) | `ANCHOR_FAMILY = "국고"`, `ANCHOR_TENOR = "3Y"` — chip defaults, marker/drag gating (`anchorVisible`), captions ("드래그는 국고 3Y 표시 중에만"). |
| `lib/recon/path-matrix.ts` | **Nothing hard-coded** — `createPathEvaluator` consumes the wire request (`customPath`/`baseShockBp`/`shockCurves`) and normalizes `factor = lerp(customPath)/baseShockBp`; the anchor is implicit in the request, exactly like the BE. The anchor-identity is only asserted in tests (국채 3Y matrix row == waypoint path). |
| `lib/recon/scenario-recon.ts` | Anchor-agnostic (KRD grid × per-tenor cumΔbp). |

**BE (e302593, `services/simulation/`):**

| Site | What is 3Y-baked |
|---|---|
| `chart.py:142-155 _factor` | `factor(t) = customPath.bp(t) / base_shock_bp` — customPath bp are read **in units of whichever pillar's terminal equals `baseShockBp`**. Not "3Y" per se: pure normalization. Guard `base_shock_bp != 0` → **`baseShockBp == 0` silently disables customPath** (known gotcha, kept per SIM2 ruling). |
| `chart.py:514-518 _ktb3y_bp` | Reporting only: `rate_path` = the 국채 curve's **3.0-year section** × multiplier (s18 dual-axis rate lane; `distribution.py:90,107` ratePaths same). Truthful regardless of anchor — it reports the 3Y section, full stop. |
| SIM2-4 activation (`chart.py:165-168`) | Non-triviality test `abs(bp − base×day/simDays) > 1e-9` on the **wire** values; when trivial, swap lanes fall to the biz-ranked ramp and `simulate_irs_path_fm` gets `path_factor=None` (the FM exception). |
| `simulate_irs_path_fm` (quant_engine, SIM2-4 additive) | Consumes only the **normalized** `path_factor` array + the swap shock curve — anchor-blind. |
| `engine/curve_cache.py` | s21 keys = the exact par-rate vector, **TOTAL by construction** ("every upstream quantity that shapes a curve reaches the bootstrap only by changing that vector"). |

**FM-engine exception — the explicit N1 interaction answer:** an anchor change under option
(a) below alters **only the FE-side path expression** — the FM engine continues to receive a
shock curve (same `generateShockCurves` construction) plus a normalized `path_factor` whose
shape is exactly what the user drew, now interpreted on the chosen pillar. Where the engine
ignores customPath today (trivial paths → step/biz-ramp regime; `path_factor=None`), it
continues to, unchanged: linear scaling preserves triviality, so a linear design on any
anchor still converts to a trivial wire path and stays in the legacy regime. N1 neither
fixes nor worsens the exception. (Under option (b) the engine would consume the anchor
natively, but as shown below it has nothing native to do with it.)

### 2. Design options

**(a) FE-side re-expression — RECOMMENDED.**

The user designs target `X` bp + waypoints + drag on the selected pillar `τa`; the FE
converts to the byte-equivalent 3Y-anchored wire request at `buildSimulateRequest` time. With
`s_rel(τ)` = the tenor-spread offset at τ from the SAME `generateShockCurves` node formula
(`s_rel(3Y) = 0`, `s_rel(1Y) = spread1y`, `s_rel(5Y) = spread10y×2/7`, `s_rel(10Y) =
spread10y`):

```
baseShockBp_wire = X − s_rel(τa)
customPath_wire[i].bp = wpAnchor[i].bp × (baseShockBp_wire / X)
```

Then for every day and tenor: `terminal(τ) = base_wire + s_rel(τ)`, `factor(day) =
wpAnchor(day)/X`, so the anchor pillar's path is `factor × (base_wire + s_rel(τa)) =
wpAnchor(day)` **exactly**, and every other tenor/family derives as today (factor × its
terminal; family = base + factor×spread — the F2/M2 identity that lane B pinned). The engine,
golden contract, s21 cache (keys total via the par vector), SIM2 pins, and lane-B recon
machinery are all untouched: the wire request is indistinguishable from a request a user
could have designed directly on 3Y.

*Backward compatibility is structural:* anchor = 3Y ⇒ `s_rel = 0` ⇒ conversion is the
identity ⇒ today's payloads byte-for-byte (pin this).

*When (a) is lossless vs ill-defined — state precisely:*
- **Lossless** whenever `X ≠ 0` and `base_wire = X − s_rel(τa) ≠ 0`: the conversion is an
  exact linear rescaling (spreads are constant additive offsets scaled by the same factor;
  waypoint lerp is linear, so pointwise conversion of waypoints reproduces the whole path).
  All four offered anchors (1/3/5/10Y) sit in the ≥1Y pure-factor zone, so the short-end/BOK
  stitching zones are not crossed by the anchor itself.
- **Ill-defined / degenerate:**
  1. `X == 0` — already broken today for 3Y (`baseShockBp==0` disables customPath); unchanged.
  2. `base_wire == 0` with `X ≠ 0` (target exactly cancels the anchor's tenor spread, e.g.
     anchor 10Y, `X = spread10y`): the wire path collapses to all-zeros and the BE guard
     silently drops it → wrong shape. **New failure mode; must be a validation error**, not a
     silent run.
  3. `|base_wire|` merely *small*: the SIM2-4 triviality test uses an ABSOLUTE 1e-9
     tolerance, so a shaped anchor design can be misclassified trivial after downscaling
     (swap lanes silently fall to biz-ramp). Mitigation: one FE guard — refuse to run when
     `|base_wire| < 0.5bp` with the honest message naming the cause (목표−스프레드 상쇄);
     covers 2. and 3. together.
  4. Spread-semantics question (owner ruling needed): this design keeps 테너 스프레드 defined
     **vs 3Y** (curve-shape inputs, labels unchanged: "국고채 테너 스프레드 (vs 국채 3Y)");
     the anchor only chooses which pillar the designed path/target pins. If the owner instead
     wants spreads re-read as "vs anchor", the conversion formula changes and the spread
     labels must move with the anchor — different (still FE-only) design.

*Cost of (a):* FE-only, ~2 commits.
- Commit 1 (core): `anchorTenor` on `ScenarioParams` (default "3Y"; rides the store like
  every other param), conversion + guard in `buildSimulateRequest` (+ exported
  `tenorSpreadAt`), Configure anchor selector (SegmentedButtons 1Y/3Y/5Y/10Y) + dynamic
  labels, Results chip shows anchor-native target (reconstruct `X = base_wire +
  interp(국채 curve, τa)` from `lastRunRequest`, remember the anchor client-side alongside
  `lastRunRequest`).
- Commit 2 (preview/drag): F2's `ANCHOR_TENOR/ANCHOR_FAMILY` become params-driven (default
  chip = the anchor; markers/drag gate on the anchor series), captions dynamic;
  `scenario-preview` naming (`gov3y` → anchor path) — display-layer only.
- Pins to re-change: configure-stage label/payload fixtures (~4-6 re-pins with `[CHANGED,
  N1]`), curve-view F2 default pins (~2). New pins (~8): anchor=3Y byte-identity of the wire
  payload; 5Y/10Y conversion exactness (terminal + waypoint path reproduce the anchor
  design through the path-matrix evaluator); degeneracy guard fires (base_wire≈0 → blocked
  run, no request); drag-in-anchor-units round trip; Results chip anchor labeling.
- Zero BE pins, zero golden churn, zero fixture regeneration (lane-B fixtures stay valid —
  they are wire-level and anchor-agnostic).

**(b) BE additive `anchorTenor` field — NOT recommended.**

The BE never builds the ktb curve from spread inputs — the FE ships resolved curves. A native
`anchorTenor` could only (i) renormalize `_factor` by `interp(국채 curve, τa)` instead of
`baseShockBp` and (ii) re-point reporting. Blast radius, enumerated:
- Request-model + golden contract: default-absent (= "3Y") byte-identity IS achievable
  (with `interp(curve, 3.0) == baseShockBp` holding for FE-built curves), but it must be
  pinned, and the API doc/golden fixtures grow a field.
- SIM2-4 activation: the triviality comparison must switch to anchor-normalized values —
  re-derivation of the activation pins + the trivial-vs-absent swap byte-identity pin.
- s21 cache keys: **no key change needed** — key totality holds automatically because
  anchorTenor reaches the bootstrap only through the shock-scaled par vector
  (curve_cache.py's totality argument). Cite, don't touch.
- `_ktb3y_bp`/ratePaths: decision forced (keep 3Y section vs report anchor section) — either
  way a contract/doc change; fan-era consumers currently dormant (HARDEN-1 removed the fan).
- Recon/fan fixtures: re-pins for any non-default-anchor fixture added.
- AND all of (a)'s FE UI work is still required (selector, labels, preview, chips) — (b)
  saves only the ~30-line conversion function while buying contract growth + BE pin churn.

**Recommendation: (a)**, with the `|base_wire| ≥ 0.5bp` guard and the spreads-stay-vs-3Y
semantics (pending the owner ruling below). It is strictly smaller: 2 FE commits, ~6-8
re-pins + ~8 new pins, no BE, no golden, no cache, no fixture churn.

### 3. Overlap check vs F2 (lane B, post-merge)

Verified from `recon/scen` @ e756ad5 (`curve-view-panel.tsx`, `lib/recon/path-matrix.ts`,
tests): **F2 fully delivers the "rate path per tenor / per credit family" half.** All 15 KRD
pillars offered as tenor chips; families 국고 · IRS · 회사채 · 여전채 individually or as
composite overlay; every series pinned equal to its M2 path-matrix row; family = base +
factor×spread pinned; 여전채 correctly rides the 카드채 curve (backend `get_sector_curve_key`
cited in code). The implementation lane builds **only the anchor selector** (N1).

Residual gaps (small, listable):
1. The anchor itself is fixed 국고 3Y (the N1 ask) — chip defaults, drag/marker gating and
   captions all reference it (the exact `ANCHOR_*` constants above).
2. Families offered are exactly the owner's four; 특은채/은행채 curves exist in the machinery
   but have no chips (add two chips if ever asked — the evaluator already handles them).
3. Multiple tenors within one family share the family color (differentiated by selection
   chips + crosshair, documented in lane B's report) — no per-tenor hue inside a family.

---

## T2 — N2: M2 Δbp time series in the daily recon (Rates History range mode)

### 1. Data source — no new endpoints, no new fetches, no new caching

Single-date M2 consumes two `marketDataApi.snapshot` responses (close D−1, as-of D) through
`lib/daily-recon-math.ts::deltaBpByTenor(TENOR_COLS, closeSnap, asOfSnap)` → per-tenor Δbp
with `null` = unmapped (pillar absent at either date; ON/CD/whole-year+6M/9M/18M swap-quote
pillar map in `pillarRates`, exact matches only).

**The range loop already computes exactly this per day and throws it away**:
`use-recon-range.ts` fetches both snapshots per (close, asOf) pair, calls `deltaBpByTenor`,
uses it for `assumedTotal`, and keeps only the scalar closure figures in `ReconRangeRow`.
N2 therefore = **retain the already-computed map** — add `deltaBp: Record<string,
number|null>` (and nothing else) to `ReconRangeRow`. Zero additional requests; the lazy
sequential loop, 20-business-day default window, +20일 확장, incremental rows, and the
no-new-caching mandate are all untouched. The ~5.5s/day cost lane A measured is unchanged
(it is the pvbp-sensitivity leg, not the snapshots).

Series-count arithmetic: 16 KRD pillars × window (20 → 40 → …) points — at the default
window that is ≤ 320 numbers per run, trivial for SeriesChart; even a maximal window (all
available dates) stays in the low thousands. User-selected chips bound what is actually
drawn (default: one series).

Family axis: **not available from this data source** — `MarketDataResponse` carries one
curve family (ON/CD/IRS pillars). Credit-family Δbp would need the credit-curve endpoints
(a different machinery); N2 chips are tenor-only, stated in the UI copy.

### 2. UI spec

- **Mount — recommended: a view toggle INSIDE the existing range strip** (`ReconRangeStrip`,
  RH mount only). The strip header gains a two-way SegmentedButtons-style toggle:
  **[잔차 표] [Δbp 시계열]** — same `useReconRange` rows, same 계산/확장/progress controls,
  zero new dockview panels or stores. Rejected alternative: a third RH dockview panel — it
  would duplicate the run state (two 계산 buttons over one uncached machinery) or force a
  shared store; the toggle keeps one run, one row set, two views.
- **Chart**: canonical `SeriesChart` (`valueKind: "bp"` — the built-in 2dp bp formatter),
  one series per selected tenor chip. Tenor chips reuse the F2 toggle-chip grammar (all 16
  `TENOR_COLS` incl. 30Y; default **3Y** selected, add via chips, last chip not
  deselectable). Colors: fixed per-tenor map over `CHART_SERIES_COLORS` (stable identity —
  a tenor keeps its hue regardless of selection order, the SECTOR_COLORS philosophy).
  Badge policy: `primary: true` on the 3Y series only (s14 collision policy, primary-only);
  pills off (chips already name the series).
- **Calendar honesty (s15 whitespace rule)**: x-axis = real calendar dates; weekend/holiday
  slots between available dates get whitespace points. A day whose Δbp is `null` (unmapped
  pillar) or whose row was excluded (server-as_of window mismatch — the strip's 비고 rows)
  contributes a **whitespace point, never zero**. If a tenor is unmapped across the whole
  window, its chip renders with the — state and the exclusion note names it (same language
  as the single-date M2 row).
- Zero-vs-unmapped: a measured 0.0bp day IS a value point at 0.0 (the 48a6b15 F2 fix's rule,
  carried into the series).

### 3. Single-component rule + parity pin

The series must be a VIEW over the SAME M2 machinery — enforced structurally: the chart
consumes `row.deltaBp`, which is the **same object** `assumedTotal` consumed in the same
loop iteration (retained, never recomputed; no second `deltaBpByTenor` call site in the
strip). Parity pins:
1. **Range↔M2 byte-equality**: for a fixture window, the chart's point value at (date D,
   tenor τ) `===` `deltaBpByTenor(TENOR_COLS, closeSnap_D, asOfSnap_D)[τ]` — and `===` the
   single-date M2 row value the `DailyReconPanel` renders for D with the same fixture
   snapshots (same function, same inputs; assert both).
2. **Null → whitespace**: an unmapped (null) tenor-date yields a whitespace point (no
   `value` key), pinned; a measured 0.0 yields `value: 0`.
3. **Reuse guard** (mirror of lane A's cashflow guard): a test failing on any second
   `deltaBpByTenor` invocation inside the strip/chart component, or on a locally-defined
   Δbp computation.

Estimated cost: 1 commit, ~+8-10 tests (hook retention pin, 3 parity/whitespace pins, chips
default/last-chip pins, toggle pins, color-map stability pin).

---

## Owner rulings needed (expected list)

1. **N1 option**: (a) FE re-expression [recommended] vs (b) BE additive field. If (a):
   confirm the **0.5bp degeneracy floor** behavior (blocked run + message) and that **테너
   스프레드 stays defined vs 3Y** (anchor moves the path, not the spread reference). If
   spreads should re-read vs the anchor instead, say so — different conversion, same
   FE-only scope.
2. **N1 Results chip**: display anchor-native ("국고 5Y 목표 변동 +30bp") reconstructed from
   the wire request + client-remembered anchor — confirm that labeling (the wire itself
   stays 3Y-normalized under (a)).
3. **N2 ship order**: before or after the trader demo. N2 is the cheap one (1 commit, no new
   fetches); N1 touches the Configure surface's semantics. If the demo is close: N2 first,
   N1 after.
4. **N2 default tenor selection** for the Δbp chart (proposed: 3Y alone; alternative: the
   1Y/3Y/5Y/10Y majors preselected).
5. (From lane A's deferred list, adjacent) per-sector realized buckets BE growth — untouched
   here; still open.
6. Doc hygiene: the standing prompts cite SIM2_DESIGN.md, which does not exist
   (SIM2_REPORT.md is the real document) — worth correcting in the next session prompt.

## What the implementation lane does NOT need to do (verified delivered)

- Per-tenor/per-family path viewing (F2, lane B — post-merge).
- M2 path matrix + M3 잔차 machinery on Simulation Results (lane B).
- Daily recon M1/M2/M3 + range residual strip + realized swap cashflow recon (lane A,
  48a6b15).
- Any BE change (both N1-(a) and N2 are FE-only).
