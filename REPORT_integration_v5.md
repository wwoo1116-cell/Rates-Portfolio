# REPORT — Integration Pass v5

**New baselines (local, unpushed):** FE `feat/simulation-migration` — merge `c26c4d9` (s20/es-render-and-markers, lane head `d646cd8`) → this report. BE `v2` — merge `dce8e78` (s21/curve-cache, lane head `2aff6a3`). Evidence: `docs/integration-v5/` (gate outputs are pasted terminal captures, per the false-pass rule). This pass supersedes `REPORT_integration_v4.md` as the integration baseline.

> **⚠ Both dev servers are DOWN at time of writing** (:8000 was already down per iv4's flag; :3000 has since stopped too). Start them with:
> `cd "…\IRS Pricer_Mock" && python -m uvicorn irs_pricer.api.app:app --port 8000`
> `cd "…\UIUX_test" && pnpm dev`
> All live captures in `docs/integration-v5/` were taken while both servers ran the merged heads.

> **Note on continuity:** this pass was executed across two sessions. The interruption point was after all merges, gates, and captures; the continuation session regenerated `retired-anchor-sweep.txt` (created empty at interruption), refreshed the two README rewrites' stale lines, and wrote this report. No code moved between the sessions — the merged heads above are the heads every capture ran against.

## T0 — Lane scope (`t0-lane-diffs.txt`)

Two lanes only, both single-commit branches off the current integration heads — merges are trivially conflict-free by construction (no divergent base):

| Merge | Lane content | Conflicts |
|---|---|---|
| FE s20/es-render-and-markers (`68f7553..d646cd8` → `c26c4d9`) | full-domain fit via GROUP applier, pinned-run trade markers + drift suppression, `minBarSpacing: 0.05` shared default, s19 xfails flipped; 13 src files + REPORT_s20 + session-s20 captures | **0** |
| BE s21/curve-cache (`40a3238..2aff6a3` → `dce8e78`) | curve-cache kill switch env, key-totality pins, capacity 32768→65536, full-book validation; `app.py` + `curve_cache.py` + tests + REPORT_s21 + session-s21 evidence | **0** |

The two lanes touch disjoint repos; no cross-lane file interaction existed to check.

## T1 — s20 at the merged head: full-domain render survives integration

- **Results C cold mount** renders the **full simulation domain**, not the ~95-bar tail window of the s19 defect (`t1-results-C-fulldomain.png`).
- **Results B cache-hit remount** — the remount path (chartRef-effect remount trap, s10) also fits full-domain (`t1-results-B-cachehit-remount.png`); **grid cold mount** likewise (`t1-results-B-grid-coldmount.png`).
- The sync-lockstep livelock (third mechanism, found in-lane by s20) stays dead at the merged head: fit applied via the GROUP applier across synced panes.

## T2 — App-wide sweep + timescale-override audit

- Screenshots at the merged head, both servers on merged code: `t2-home.png`, `t2-portfolio.png`, `t2-rates-history.png`, `t2-sim-configure.png`, `t2-sim-results-dualaxis.png` — s14 grid policy, s16 column alignment, s18 dual-axis fan, iv4 funding chips all visibly intact.
- **Timescale-override audit** (`t2-timescale-overrides.txt`): repo-wide grep shows `timeScale` configured in exactly the expected sites — `lw-chart-base.tsx` (shared `minBarSpacing: 0.05` default), the ES `fit-harness.ts` (reads the shipped default, never hardcodes), and the two simulation slice hosts (`lw-line-chart`, `rate-fan-chart`, border/visibility only — no `minBarSpacing` override). No component silently overrides s20's floor.

## T3 — Pinned-run markers & drift suppression

- Detached z-score panel shows the oscillator **micronote** tying markers to the pinned run (`t3-detached-zscore-micronote.png`).
- Drift-suppressed state renders the **banner** instead of silently dropping markers (`t3-drift-suppressed-banner.png`) — marker-trade correspondence is the s20 contract: markers come from the pinned run's trades, never recomputed live.

## T4 — Gates at the merged heads (`gate-*.txt`)

| Gate | Expected | Got |
|---|---|---|
| FE vitest | 221 passed, **0 xfail** (s20 flipped s19's 3 xfails to passing) | **221 passed (221)**, 0 failed (`gate-fe.txt`) |
| FE tsc | clean | clean, exit 0 |
| FE eslint repo-wide | **exactly 21 errors** (red baseline, not fewer, not more) | **21 errors / 26 warnings** |
| FE build | clean | clean (`gate-fe-build.txt`) |
| BE pytest | 327 + 4 xfail (iv4 final) + s21's curve-cache tests | **336 passed + 4 xfail** (`gate-be.txt`) — +9 = `tests/test_curve_cache.py` |
| BE frozen-market anchors | green | **42 passed** |

## T5 — ES KPI anchors + console sweep (`anchor-es-kpis.txt`, `retired-anchor-sweep.txt`, `t5-console-sweep.txt`)

| Config | Expected (s19/s20 corrected baseline) | Got | Verdict |
|---|---|---|---|
| B — IRS 10Y−3Y, defaults, entry 2σ | 92 trades / net 71,450,000 | trades=92 net=71,450,000 win=64% sharpe=0.26 | **PASS, exact** |
| C — IRS 3Y outright, defaults, entry 2σ | 69 trades / net −432,400,000 | trades=69 net=−432,400,000 win=43% sharpe=−0.59 | **PASS, exact** |
| A — 국고 10Y−3Y, lookback 60, entry 3σ | **24 / 10,600,000** (s19-corrected; the historical 35 / 70.4M capture is retired as non-reproducible, per s19 diagnosis and s20's exclusion ruling) | trades=24 net=10,600,000 | **PASS against the corrected baseline** — the evidence file's header still says "expect 35 trades / 70.4M"; that is the retired label, kept verbatim as capture history |

- **Retired-anchor sweep**: `grep` over `src/` for `70.4M / 70,400,000 / 70400000` = **zero hits** — no product or test code still expects the retired capture. Documentary mentions remain only in historical reports (iv2/iv3, s19/s20), which is correct.
- **Console sweep**: zero console errors across all routes/contexts (`t5-console-sweep.txt`); `t5-optimal.png`, `t5-settings.png` — Settings funding hero still reads the backend policy constant (2.85%), iv4's T5 contract intact.

## s21 at the merged head (BE)

Merged tree is byte-identical to the s21 lane head (single-commit lane, zero conflicts). The lane's own full-book validation stands as the perf evidence (`docs/session-s21/`): **1,409.7s → 118.6s** full-book simulate, real book = **11,661 cache keys** (shock-shape-dependent — the s18 ramp shape alone underestimates), capacity raised 32768→65536, kill-switch env var, key-totality pins. FM residual ~82s remains the next perf target (unchanged from the lane report).

## Self-resolved ambiguities

1. **`retired-anchor-sweep.txt` was zero bytes at interruption** — regenerated in the continuation session as a fresh grep at the same merged head `c26c4d9`. It is the only evidence file not produced in the original capture session; its content is mechanical (a grep) and reproducible.
2. **BE `session6_dashboard_before.*` uncommitted fresh-capture drift** — left in the working tree per the iv3/iv4 convention (iv4 report, self-resolved #1). Not restored, not committed.
3. **README rewrites (both repos, Korean)** — were in flight at interruption; the FE one predated the s20 merge and still cited iv4 as baseline and listed the ES tail-window race as open. Fixed to cite this report and record the s20 fix. Committed with this report.
4. **Servers not relaunched** — iv4's relaunch was blocked as an owner-workload operation; same ruling applied, commands at the top.
5. **FE `.impeccable/hook.cache.json` dirty** — hook cache, left as-is (same disposition as iv4).

## Findings for the owner's ledger (not touched, per scope)

- Unchanged from iv4 — no new owner-ledger findings surfaced in this pass.
- Reminder: `/api/spread-backtest` remains UI-orphaned (backtest is client-side); FM residual ~82s is the next BE perf target.
