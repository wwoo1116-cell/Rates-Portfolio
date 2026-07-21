# FB5-LAND — live smoke evidence

Landed head **`9342209`** on `feat/simulation-migration`, served by `next start`
on **:3000** (new PID **16188**, health 200). BE **:8000** (PID 12596) untouched
throughout. Environment is headless, so each of the five feedback items is
evidenced by (1) the **served client bundle** carrying the fix's signature
strings, (2) the **behavioral vitest pin** (444/444 on the merged head), and
(3) route health. Final visual confirmation is the owner's live eye-verify.

## Server / restart discipline
| | |
|---|---|
| Build | `next build` exit 0, all 13 routes generated |
| Old :3000 | PID 17164 (FB4 build) — `taskkill /F` → confirmed gone, port freed |
| New :3000 | PID 16188, `next start`, `✓ Ready`, health **200** |
| Routes | `/ /home /rates-history /simulation /portfolio /entry-signals` → all **200** |
| BE :8000 | PID 12596 unchanged, `/api/market-data/range` → **200** (never touched) |

## a. ② Trace-date rate context (PnL Trace)
- Bundle `chunks/0jfy9zxpubt28.js`: `Rate Context`, `차트 시리즈`,
  `trace-benchmark-rates` testid all present.
- Behavior pinned: `pnl-trace-panel.test.tsx › A1 traced-date rate context
  (same-source)` — IRS 3Y/10Y benchmark from the clicked point; each charted
  series' value at the date equals its `buildInstrumentSeries` lineData value
  (same-source, no re-fetch); a quoteless series renders `—`.

## b. F3 follow-up — +1/−1 labels removed
- Bundle: the string `coefficient` (the old `Leg N coefficient` aria-label) is
  **absent** from every client chunk → the read-only ±1 labels are gone from the
  shipped spread builder.
- Behavior pinned: `instrument-selector.test.tsx` label-absence pins (no
  `/coefficient/i` element, no `+1`/`-1`/`+2` text); the weight-emission pins
  (canonical `[1,-1]`/`[1,-2,1]` + weight-encoded id) stay green → coefficients
  remain internal & byte-identical.

## c. Recon display follow-ups (daily-recon + range strip)
- Bundle `chunks/33olc-d9fsvmu.js` + `3y-_fevsgc3v2.js`: `혼합 근거`,
  `블로터 기준일`, `예상 소액`, `reval DV01` all present.
- Behavior pinned: `daily-recon-panel.test.tsx` (stale blotter chip shows
  `2026-03-23`; fresh export hides it; mixed-basis `reval/fallback/FRN` counts;
  M3 KRD-present + Δbp-0.0 → `0`, `—` for unmapped/no-KRD),
  `daily-recon-math.test.ts` (dv01Meta / isBlotterStale / honest-zero),
  `recon-range-strip.test.tsx` (`|예상| < ₩1M` → `—` + tooltip, absolute 잔차
  intact). Blotter remains stale in the current export → chip shows 2026-03-23.

## d. ③ Simulation taxonomy + chip-draw fix
- Bundle `chunks/33olc-d9fsvmu.js`: `기준 등급` (representative-rating caption)
  and `가정(Assumed)` present.
- Payload identity: the `creditSpreads` param keys `은행채` / `카드채` / `특은채`
  are all still present in the bundle → the shock-curve payload is unchanged
  (display relabel only). `통안채`/`특은채` chips are **absent** per the lane-B
  ruling (matches the Rate History selector; disabled-with-reason variant
  `스냅샷에 커브 없음` deliberately NOT shipped — confirmed absent from bundle).
- Behavior pinned: `curve-view-panel.test.tsx` (every enabled chip draws ≥1
  series; labels pinned against `SECTOR_ORDER`).

## e. ④ 시계열형 crosshair Δbp + ⑤ 시나리오 대사 기여(M3)
- Bundle `chunks/3mn658oymm_fz.js` + `3y-_fevsgc3v2.js`: `기여` subtab and
  `가정(Assumed)` tie caption present.
- Behavior pinned: `curve-view-panel.test.tsx` B2 (per-series Δbp readout from
  `param.seriesData`; `—` on whitespace days, `+0.0bp` pinned absent);
  `scenario-recon.test.ts` + `scenario-recon-panel.test.tsx` B3 (day-selector,
  grid closes to book total = `assumed(day)` to 6 dp, genuine-zero vs em-dash).

## Gate summary (merged head 9342209)
- `tsc --noEmit`: clean · `eslint`: 13E / 21W (baseline) · `vitest run`:
  **444 / 444** (56 files) = 423 base + 11 lane A + 10 lane B (exact, no drift).
