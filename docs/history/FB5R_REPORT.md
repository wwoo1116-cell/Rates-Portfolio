# FB5R — Exact-rulings pass (R1 · R2 · R3)

Single session: fix → gates → build → restart :3000 → live smoke → land.
Base FE mainline `feat/simulation-migration` @ **9a148c5**; work on branch
`fb5r/exact-rulings`. BE @ `11a4daf` untouched, `:8000` (PID 12596) never
touched. Baselines re-derived: **vitest 444 / eslint 13E·21W** at base.

New baselines after this pass: **vitest 458 / eslint 13E·21W**, tsc clean,
`next build` green.

---

## R1 — Rate History chart: rate readout AT the chart (owner feedback ②)

**Before:** the traced-date rate context landed only inside the *PnL Trace*
panel (FB5-A A1). The Rate History chart itself surfaced nothing under the
crosshair.

**After:** a crosshair-bound readout strip lives on the RH chart host. Hovering
shows, under the crosshair date: the **IRS 3Y / IRS 10Y benchmark pair** plus
**every charted series' own rate** (label + color). Clicking a date (trace)
**pins** the same row so it survives the cursor leaving. The strip is always
present (reserved) with an idle hint, so it never reads as "nothing there". The
PnL-Trace context row STAYS unchanged (it was not what the owner asked to see on
this screen; both now exist).

**Mechanism (as ruled — generalize FB5-B B2, same-source, no recompute):**
- `SeriesChart` (the canonical S7 host) gained an **opt-in** `onCrosshairMove`
  prop that emits, per visible series, its plotted value at the crosshair date —
  sourced from lightweight-charts' own `param.seriesData` (the exact points the
  lines are drawn from) and pre-formatted through each series' resolved
  formatter. A `readout` field was added to the click context so a host can pin
  the traced date. Both are **additive**: every other `SeriesChart` consumer
  that omits `onCrosshairMove` is byte-identical — the readout branch never runs.
- The **benchmark pair** is composed by the RH host from the already-loaded
  `rate-history` points (no new endpoint), and **deduped** against the charted
  series: a benchmark tenor that IS charted shows once (as its colored series);
  one that is NOT charted shows as a `기준` reference. A tenor with no quote that
  day reads `—` (honest, never a fabricated rate).

**Pins:** `src/features/home/rate-history-chart.test.tsx` (4) — reserved strip +
idle hint; charted-series value + uncharted-benchmark surfacing + dedup;
quoteless-day `—`; click-to-pin persists past cursor-leave. Opt-in byte-identity
for non-consumers is structural (prop defaults undefined, branch gated) and
regression-verified live.

**Live smoke (`/rates-history` → Rate History tab):**
- Hover → `2013-03-25 · IRS 3Y 2.6475% · IRS 10Y 2.9225%` (both defaults charted,
  shown as colored series; benchmark deduped).
  `fb5r-evidence/R1-rh-readout-charted-series.png`
- Removed IRS 10Y chip → hover → `2024-11-05 · 기준 IRS 10Y 2.9875% · IRS 3Y 2.9575%`
  — IRS 10Y persists as the `기준` benchmark though uncharted.
  `fb5r-evidence/R1-rh-benchmark-uncharted-IRS10Y.png`
- Clicked a date → switched to PnL Trace (FB5-A routing, kept) with its context
  `2024-01-30 · IRS 3Y 3.2375% · IRS 10Y 3.2175%`; back on Rate History with the
  cursor off-chart the row stays **pinned** at `2024-01-30`.
- Regression: Portfolio → Position Details MTM (Last 1Y) SeriesChart renders
  byte-identically, **no** readout strip (opt-in off).
  `fb5r-evidence/R1-regression-portfolio-mtm-no-strip.jpg`

---

## R2 — Preview selection = the LITERAL Rate History selector (+ owner amendment)

**Before:** the 커브형/시계열형 preview selected through bespoke `ToggleChip`
rows — a 1D~10Y tenor button row and a 곡선군 chip row — with the PVBP taxonomy
as data.

**After:** BOTH previews select through the **imported** Rate History control row
(`InstrumentSelector`): `[자산군][등급][테너][Add]` with removable color chips
beneath — the RH grammar, configured per mode:
- **시계열형:** 자산군 + 테너 enabled, 등급 **N/A** (the path is family-based via
  `sectorToFamily`, so rating has no effect). Add appends a `(family × tenor)`
  series chip; the old 1D~10Y button row and 곡선군 chip row are gone.
- **커브형:** 자산군 enabled, 테너 **N/A** (a family = the whole curve). Add
  appends/updates a family chip.
- **등급 (owner amendment — user-selectable, not read-only):** for a rated
  sector the middle dropdown is **live**, defaulting to the auto-resolved 기준
  등급 (`ratings[0]`); changing it refetches that family's base curve at the
  chosen tier and the `기준 등급:` caption reflects the choice. 국고/IRS stay N/A.
  No new picker — this is the RH selector's own dropdown.

All B1 data semantics survive: PVBP taxonomy names, carried-only roster
(통안채·특은채 absent), honest blank/`—` policy, and — crucially — the simulate
payload is **selection-blind** (`buildSimulateRequest` reads only inputs/params),
so payload parity is structural (pin green).

### Import vs mirror — decision: **IMPORT (via a principled relocation)**

The owner directed importing the RH selector and, in the amendment, "the RH
selector's **own** dropdown doing its job — no new picker component." A mirror was
therefore rejected. Straight import hit one real constraint: the simulation slice's
`no-restricted-imports` boundary forbids `@/features/*` (it may import only
`@/components/ui/**`, `@/components/charts/**`, `@/lib/**`). The codebase's own
precedent resolves this: the canonical `SeriesChart` was relocated to
`@/components/charts` precisely to be the one shared, slice-sanctioned charting
surface. `InstrumentSelector` is already shared across **home, entry-signals, and
rates-history** — it was mis-homed in one feature. So it was **relocated to
`@/components/ui/instrument-selector`** (a control shared across features belongs
in shared space), all importers repointed, and the slice now imports it cleanly
with **no lint suppression** and **no boundary violation**. Its dependencies were
already all slice-legal (`@/lib/*`, `@/components/ui/button`, external pkgs).

The component was extended with **optional, default-preserving** config props so
the RH call sites stay byte-identical: `modes` (single-mode hides the
Outright/Spread toggle), `showFilter`, `ratingDisabled`, `tenorDisabled`,
`colorOf` (chip swatch = PVBP sector token so a chip matches its line). `등급`/`테너`
N/A locking lives in `LegPicker`; the emit omits the locked slot.

**Pins:**
- `src/components/ui/instrument-selector.test.tsx` — 5 original RH pins (spread
  coefficients / label-absence) **unchanged and green** (default-props =
  byte-identical RH surface), + 5 new: defaults keep the RH surface; single-mode
  + no-filter config; 시계열형 `ratingDisabled` → rating:null; 커브형 `tenorDisabled`
  + live 등급 tier flows to the leg; `colorOf` override.
- `scripts/check_preview_selector_reuse.test.ts` (reuse guard, source-level) —
  the panel **imports** `@/components/ui/instrument-selector` and renders it in
  both modes; owns **no** `HTMLSelect`/`@blueprintjs` grammar of its own (no
  mirror); old `ToggleChip`/`aria-pressed`/`toggleIn`/`sel*Families` markup
  **absent**; the shared component genuinely carries the preview config props.
- `curve-view-panel.test.tsx` — F2 series/family round-trip equals the M2 path
  matrix (same-source); B1 rated-sector fetch at rep rating; **amendment**: the
  live 등급 redraws at the chosen tier; carried-only roster (여전채 offered,
  통안채 not); payload parity.

**Live smoke (`/simulation`, baseDate 2026-07-15):**
- 커브형: control row `[국고채][N/A][N/A][Add]` + removable 국고채·IRS chips;
  set 자산군→여전채 makes 등급 **live** (AAA(카드)…BBB-(기타)); Add 여전채 @
  `AA (카드)` → curve drew + caption `기준 등급: 여전채 AA (카드)`; re-Add @ `AAA
  (카드)` updated the same chip in place and redrew tighter — caption followed.
  `fb5r-evidence/R2-curve-yeojeon-AA-live-rating.jpg`
- 시계열형: control row `[자산군][N/A 등급][테너][Add]` + 국고채 3Y anchor chip;
  Add 시은채 1Y → both series drew; removed via chip ×.

---

## R3 — 시계열형 crosshair Δbp row not visible live

**Diagnosis (evidence-based, on the live `9a148c5` bundle BEFORE changes):**
The crosshair readout **did** fire and render on hover (verified at a tall window
and at 1440×760) — the subscription is alive, not dead, not clipped off-screen.
The real fault was **placement / affordance**: the FB5-B B2 row was a tiny,
centered `text-micro` **footer at the very bottom of the panel**, stacked
directly above and stylistically identical to the static legend row — it read as
part of the legend. It was also fully **hover-transient with no reserved space**
and sat **far from the crosshair** (the user's gaze follows the cursor mid-chart;
by the time they look at the footer the cursor has moved/left and the row is
gone). Net effect during eye-verify: "nothing shows."

**Why the unit pin missed it:** the B2 test **fully mocks `LwLineChart`** and
hand-calls `onCrosshairMove`, so it proved the panel *can* render a row given
data but never that the row is wired to a real subscription or discoverable under
default hover — exactly the gap the owner named.

**Fix:** the readout is now a **prominent, reserved, always-present strip** at the
chart (its own bordered bar, distinct from the legend), directly beneath the
chart — "under the crosshair date." It fills on hover with the crosshair date +
each series' plotted Δbp (never recomputed; whitespace day → `—`) and shows an
idle hint otherwise, so it can never read as absent. Unified with R1's RH readout
treatment.

**Flow-level pin** (`curve-view-panel.test.tsx`): the strip
(`data-testid="path-crosshair-readout"`) is present under **default** conditions
with **no** hover, and `onCrosshairMove` is actually wired to the chart — it fails
if the row is gated off or the wiring is dropped (the gap the fully-mocked unit
pin could not cover). The B2 value/whitespace behavior pins are retained.

**Live smoke:** hovering the default 시계열형 chart shows
`2026-10-13 · 국고채 3Y +15.0bp` in the reserved strip; with 시은채 1Y added,
`… · 국고채 3Y +14.5bp · 시은채 1Y +14.5bp`.
`fb5r-evidence/R3-path-crosshair-readout.jpg`

---

## Gates · land · smoke

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean (0) |
| `vitest run` | **458 passed** (56→58 files; +14: R1 host 4, selector config 5, reuse guard 4, panel net +1) |
| `eslint .` | **13 errors · 21 warnings** (baseline; all new files clean) |
| all reuse/byte-identity guards | green (preview-overlay, Δbp, preview-selector, RH selector defaults) |
| `next build` | success (exit 0) |
| tree | clean (hook-cache churn restored to base) |

**Single build window:** `next build` → killed the old `:3000` tree
(pnpm→cmd→next PID 16188), confirmed **PORT 3000 FREE** and `:8000` PID 12596
intact → `next start` fresh → health **200** (new PID 20380). `:8000` never
touched.

**Servers RUNNING** at report time: `:3000` PID 20380 (fresh build, 200),
`:8000` PID 12596 (BE `11a4daf`, untouched).

Evidence: `fb5r-evidence/` (5 captures listed above).

## Files

- `src/components/charts/series-chart.tsx` — opt-in `onCrosshairMove` + `readout`
  in click ctx (same-source, additive).
- `src/features/home/rate-history-chart.tsx` — crosshair readout strip +
  benchmark pair + click-pin.
- `src/components/ui/instrument-selector.{tsx,test.tsx}` — **relocated** from
  `features/rates-history/`; extended with default-preserving config props.
- `src/features/{entry-signals,home}/…`, `curve-view-panel.tsx` — repointed
  imports to the new location.
- `src/features/simulation/components/panels/curve-view-panel.tsx` — both
  previews on the shared selector; readout strip relocated (R3).
- `src/features/simulation/hooks/use-input-curves.ts` — `ratingOverride` on
  `useSectorInputQuotes` (live 커브형 tier).
- `scripts/check_preview_selector_reuse.test.ts` — new reuse guard.

## Landed + pushed

- Deliverable commit `76bbe83` on `fb5r/exact-rulings`, merged `--no-ff` into
  mainline `feat/simulation-migration` → **head `d62adc0`**, tag **`fb5r` @
  `d62adc0`**.
- Pushed to `origin` (GitHub `wwoo1116-cell/Rates-Portfolio`) — `--all` +
  `--tags`; remote verified: `refs/heads/feat/simulation-migration` = `d62adc0`,
  `refs/tags/fb5r` = `d62adc0`. **Backup semantics — no `.vercel` git
  integration present (re-verified), so no deploy triggered.**
- `:3000` was built from this exact tree (deliverable commit content) and
  restarted on it (PID 20380, health 200); `:8000` (BE `11a4daf`, PID 12596)
  never touched. Owner eye-verify pending.
