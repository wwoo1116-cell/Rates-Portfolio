# FB5-B — Simulation: family taxonomy + chip bug, crosshair Δbp readout, scenario M3 grid

Lane B of the FB5 two-lane pass. Worktree only — **NO build, NO restart, NO push.**
The landing pass owns the single build+restart window.

## Step 0 — base & environment

| Item | Value |
| --- | --- |
| FE mainline | `feat/simulation-migration` |
| **Base head (recorded)** | **`0471ed4`** — `docs(fb4): landing report … tag fb4` |
| `fb4` tag | `6a530f1` — **ancestor of HEAD ✓** |
| Worktree | `../wt-fb5-sim` (fresh) |
| Branch | `fb5/sim-recon-display` (new) |
| Dual-dispatch guard | PASS — main tree clean, no pre-existing `fb5/*` branch, no `wt-fb5-*` dir, no unattributable files |
| BE | `krw-fi-pms-backend` @ `11a4daf` (v2, dv01 line) — clean, **read-only context** |

### Gate baselines (re-derived from the checkout)

| Gate | Baseline |
| --- | --- |
| `tsc --noEmit` | **clean** (exit 0) |
| `vitest run` | **423 passed / 56 files** |
| `eslint .` | **13 errors, 21 warnings** (pre-existing; all outside the simulation curve/recon surfaces) |

`node_modules` is a directory junction to the main checkout's store (pnpm; same commit
lineage) — tooling only, no install, no build.

---

## B1 Phase 1 — DIAGNOSIS (reported before any fix commit)

### 1. What the preview snapshot actually carries — three colliding taxonomies

The bug is a **naming-system collision**. Three distinct sector vocabularies are in play,
and the 커브형/시계열형 chips pick a *different subset with different names* than the grids
they sit above:

**① Blotter / PVBP sector taxonomy** — the labels the M1 KRD grid and M2 path-matrix rows
carry, and what a position's `sector` field is.
`국고채 · 통안채 · 공사채 · 특은채 · 시은채 · 여전채 · 회사채`
Source: `loaders/portfolio.py` `_BOND_SECTOR_MAP`; mirrored FE-side by
`chart-colors.ts` `SECTOR_ORDER` (line 111) + `sectorColor()` (exactly these 7 keys).

**② Shock-curve family keys** (`CurveFamilyKey`) — what `req.shockCurves.bondCurves` is
keyed by, i.e. what the scenario ghost / path evaluator reads.
`국채 · 은행채 · 특은채 · 카드채 · 회사채 · swap`
Mapping (`daily_valuation.py:16-23` `get_sector_curve_key` ≡ `path-matrix.ts:83-92`
`sectorToFamily`):
`국고/통안/국채→국채 · 시은/은행→은행채 · 특은/공사→특은채 · 여전/카드→카드채 · 회사→회사채 · IRS/OIS→swap`.

**③ Credit-matrix taxonomy sectors** — what the **커브형 BASE quotes are actually fetched
from** (`creditCurveApi.taxonomy()`).
`credit_taxonomy.py:173` `SECTOR_ORDER = [국고채, IRS, 공사채, 시은채, 여전채, 회사채]`.
- `국고채` is **unrated** (single `NO_RATING = ""` bucket).
- `공사채 · 시은채 · 여전채 · 회사채` are all **RATED / multi-bucket** — every key is a rated
  display string (`"AAA (공모)"`, `"AA (카드)"`, …); **there is no `""` / unrated bucket**.
- **No `통안채`, no `특은채`.**

The current 커브형 chips (`CURVE_FAMILIES` = `국고채·통안채·IRS·회사채·여전채`) and the spread
accordion (`configure-stage.tsx` `CREDIT_SECTORS` = `특은채·은행채·카드채·회사채`) each name a
different, partial subset — **neither matches the PVBP list the M1/M2 grids display.**

### 2. Credit-matrix ↔ PVBP sector mapping (with loader evidence)

From `credit_taxonomy.py` docstring (lines 11-21, "user-confirmed") and
`credit_curve_service.py` `_SECTOR_TO_TAXONOMY` (lines 79-87):

| PVBP sector (①) | credit-matrix sector (③) | real base curve? | evidence |
| --- | --- | --- | --- |
| 국고채 | 국고채 | ✅ unrated | `SECTORS["국고채"][""]` = `시가평가 3사평균 국고채권` |
| 통안채 | 국고채 *(fallback)* | ❌ no own curve | `_SECTOR_TO_TAXONOMY["통안채"]="국고채"` — "Matrix에 통안채 커브 없음" |
| 공사채 | 공사채 | ✅ rated | `SECTORS["공사채"]` = 공사/공단채 tiers |
| 특은채 | 시은채 *(fallback)* | ❌ no own curve | `_SECTOR_TO_TAXONOMY["특은채"]="시은채"` — 특수은행채→은행채 |
| 시은채 | 시은채 | ✅ rated | raw category `금융채 **은행채** …` |
| 여전채 | 여전채 | ✅ rated | raw category `금융채 **카드채** …` + `기타금융채 …` |
| 회사채 | 회사채 | ✅ rated | `회사채…(공모/무보증)` + `(사모/무)` |

**The owner's suspected mappings are CONFIRMED:**
- **은행채 ↔ 시은채** — the shock-family key `은행채` is the credit-matrix *raw curve name*
  for the PVBP sector **시은채** (the string "시은채" is not itself a source category).
- **카드채 ↔ 여전채** — the shock-family key `카드채` is one of the two raw curves
  (`카드채` + `기타금융채`) under the PVBP sector **여전채**.

### 3. Silent-chip root cause — *where the lookup misses and why nothing is drawn AND nothing is said*

**Why the chips appear at all.** `curve-view-panel.tsx` `familyRoster` shows a bond family
when `sectorQueries[key].carried` (`taxonomy.data.sectors.some(s => s.sector === key)`) is
true. All `useSectorInputQuotes` hooks share **one** react-query key
(`["simulation","credit-taxonomy"]`), so once `국고채` (enabled by default) fills the cache,
`회사채`/`여전채` both report `carried = true` (both ARE in `SECTOR_ORDER`) → their chips
render and are clickable. `통안채` is **not** in `SECTOR_ORDER` → `carried=false` → its chip
never appears (a separate silent omission).

**The miss.** Clicking `회사채` selects it → `useSectorInputQuotes("회사채", baseDate, true)`
fires `creditCurveApi.series({ legs: tenors.map(t => ({ sector:"회사채", rating: null, tenor:t })) })`.
Backend `get_series("회사채", rating=None, …)`:

```
category = raw_category("회사채", None or NO_RATING="")   # = SECTORS["회사채"].get("")  → None
if category is None: raise ValueError("알 수 없는 섹터/등급…")
```

`회사채` (and every rated sector) has **no `""` bucket**, so `raw_category` returns `None` →
`ValueError`. The **batch** router (`credit_curve.py:32-71`) catches per-leg `ValueError` and
returns that leg with `points: []` + an `error` string, **HTTP 200** (so one bad leg never
blanks a multi-series chart — but here *every* leg is bad).

**Why nothing is drawn.** Back in the hook, every result has `points: []` → `point`
undefined → `quotes.push({ rate: null })` for **every** tenor. `buildScenarioOverlay` then
pushes `null` for every pillar (`basePct`/`shockedPct` all null) → `TermStructureChart`
renders only gaps → **blank curve**. The DASHED scenario ghost math is *fine*
(`sectorToFamily("회사채")→회사채`, `여전채→카드채`, both present in `shockCurves`); it is
suppressed only because it is anchored to the missing base quote.

**Why nothing is said.** The per-family legend notice (`호가 없음 —`) is gated on
`sectorQueries[key].isError`, which is **false** — the HTTP call *succeeded* (200), it just
carried per-leg error strings the hook discards. The `missingByFamily` caption *would* list
every tenor as `결측 호가`, but that message means "quotes missing on this date" — a **lie**
about the real cause (the sector needs a rating; none was sent) — and the chart is blank
regardless. So the honest failure mode ("this sector has no rating-free curve") never
surfaces.

**Why 국고채 works but 회사채/여전채 don't.** `국고채` is the *only* credit-matrix sector with a
`NO_RATING=""` bucket, so `raw_category("국고채","")` resolves. Every other credit sector is
rated with no `""` key, so a `rating: null` request can never resolve. **The bug is the
hardcoded `rating: null` in `useSectorInputQuotes` for RATED sectors.**

---

## B1 Phase 2 — fix plan (per owner rulings)

1. **Naming (①/④).** 커브형 chips use the **PVBP sector taxonomy**, sourced from the single
   canonical `chart-colors.ts` `SECTOR_ORDER` (imported — no forked list; reuse-guard). The
   spread accordion labels are relabeled to the same PVBP names *for display only*, keeping
   the underlying `creditSpreads` param keys (`특은채/은행채/카드채/회사채`) untouched so the
   payload is byte-identical (`generateShockCurves` reads those exact keys).
2. **Selector grammar (②).** Chip set/ordering mirror the Rate History selector's option
   *source* (`creditCurveApi.taxonomy()`) for enablement and the rated→representative-rating
   default (`ratings[0]`, exactly as the shared `LegPicker` defaults). Benchmark-first order
   `국고채 · IRS · 통안채 · 공사채 · 특은채 · 시은채 · 여전채 · 회사채`. Tenor vocabulary stays the
   snapshot's own quote tenors. Reuse-guard note: the shared `InstrumentSelector` is a
   cascading Sector→Rating→Tenor *add/remove* control — structurally different from the
   panel's multi-select family chips — so its **option source** is mirrored, not the widget.
3. **Honesty (③).** The **root-cause fix**: for a rated sector send a *representative rating*
   (`ratings[0]`) instead of `null` → a **real** credit-matrix curve draws (no invented
   math, mirrors the RV selector default). A sector with **no** curve in the snapshot
   (`통안채`, `특은채` — absent from the credit taxonomy) renders a **disabled** chip with the
   reason `스냅샷에 커브 없음` — never a clickable chip that silently draws nothing. The
   representative rating is disclosed in a caption for honesty.
4. **Pins.** Every enabled chip draws ≥1 series; disabled chips carry the reason; chip labels
   pinned against `SECTOR_ORDER`.

*(B2 same-source evidence, B3 tie-out numbers, and final test enumeration appended after the
fix commits.)*
