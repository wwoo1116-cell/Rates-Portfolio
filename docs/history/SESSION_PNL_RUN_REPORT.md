# SESSION_PNL_RUN_REPORT — PnL Trace: Explicit RUN Button (S9)

**Executed 2026-07-15, unattended.** Branch `s9/pnl-trace-run` in worktree `wt-s9-fe`, forked from
mainline `777fd00`. Frontend only; one feature commit (`ccd348d`) + this report. Merge via the
integration pass.

## 1. Current trigger mechanism (as found — no refactor)

The PnL Trace panel is a dockview panel registered as `pnltrace` in both workspaces, but its only
opener is the **Rate History chart's date-click**: `src/features/home/rate-history-chart.tsx`
subscribes to lightweight-charts clicks and, for a click on empty chart area or an outright series
(not a spread), calls `api.addPanel({ component: "pnltrace", params: { point } })` with the clicked
date's market-rate row — the panel mounts with Start Date = clicked date, Maturity/IRS Rate empty.
That chart is mounted on the **/rates-history** page (via `rates-history-workspace.tsx`; despite
the file living under `features/home/`, the home workspace does not mount it). Once open, the
*only* computation trigger was a `useEffect` that auto-fires `useNpvTrace().mutate(...)` whenever
all inputs are valid and any of them (or the data range) changes. Consequences observed: the trace
runs implicitly as the user types; and because the effect's dependencies are the inputs themselves,
a **failed request could never be retried without editing a field**, and an already-computed
combination could not be explicitly re-run. The observed "valid inputs, empty chart" state is
exactly the post-error (or pre-fill) state with no run control.

## 2. What was added (all additive)

- **RUN button** (`Button` primitive, default `primary` = accent variant, `size="sm"` to match the
  row's `h-7` controls) to the right of the PAY/REC toggle group, inside the same
  `flex flex-wrap items-end gap-3` row — no new spacing values.
- One shared `runTrace()` (useCallback) now builds the request from the **current form values**;
  the pre-existing auto-trace effect calls the same function with its original dependency list, so
  every existing trigger path behaves exactly as before (pinned by a test that asserts `mutate`
  fires on input change with no click).
- **Disabled state** while inputs are invalid, with a tooltip naming the first failing rule
  (Start/Maturity required, maturity ≤ start, empty/NaN rate, empty/NaN notional). The `title`
  lives on a wrapper `div` because the primitive sets `disabled:pointer-events-none` — a title on
  the button itself would never show.
- **Loading state**: the primitive's built-in `loading` spinner, driven by `mutation.isPending`
  (also disables the button).
- **Error state**: a backend failure now renders its message centered **where the chart would
  render** (bordered `bg-bg-elevated` block, `text-sem-negative`) instead of the old one-line
  paragraph above an absent chart. The old "inline error above a still-rendered chart" branch was
  removed as *unreachable*: react-query's `useMutation` union resets `data` to `undefined` on
  error (TypeScript narrows `isError && data` to `never`), so error-block and chart-block are
  mutually exclusive by construction.
- **Enter key** in any form *field* triggers the same run (nice-to-have): keydown handler on the
  inputs row, gated to `<input>` targets — `preventDefault` on a focused `<button>` would swallow
  PAY/REC/RUN's own native Enter activation — and a no-op while a trace is in flight.

## 3. Scope discipline & adjacency flag

**The form and the chart live in one file** (`pnl-trace-panel.tsx`). The diff is confined to the
import block, the validation/`runTrace` region, the inputs row, and the error/chart-gating JSX;
the chart effect (series creation, markers, crosshair, tooltip) is byte-untouched. `git show
--name-only ccd348d`:

```
docs/session-pnl-run/run-disabled.png
docs/session-pnl-run/run-error.png
docs/session-pnl-run/run-idle-first-trace.png
docs/session-pnl-run/run-loading.png
docs/session-pnl-run/run-rerun-success.png
src/features/home/pnl-trace-panel.test.tsx
src/features/home/pnl-trace-panel.tsx
```

No `tokens.css`, no chart color logic, no backend files. The impeccable design hook re-flagged the
**pre-existing** chart-marker literals (`rgba(30, 185, 128, 1)` / `rgba(224, 72, 72, 1)`) because
my edits shifted their line numbers — those are the s7/chart-colors session's territory and were
deliberately left untouched (no config ignore persisted either; that's s7's/owner's call).
Also untouched: the ledgered "−0 KRW" tooltip sign bug (out of scope per the order).

## 4. Verification

| Gate | Result |
|---|---|
| Vitest | **94/94** (81 baseline + 13 new in `pnl-trace-panel.test.tsx`) |
| `tsc --noEmit` | clean |
| `eslint src` | **51 problems (24 errors / 27 warnings) = mainline baseline exactly** (inherited; none in the diff — see s8's note that mainline eslint is red) |
| `next build` | clean, all pages |

New tests (jsdom, chart stack mocked; form/trigger region only): disabled-on-invalid for **each**
rule with the exact tooltip text; enabled+no-tooltip when valid; click dispatches **once** with the
exact request payload built from current values (incl. direction toggled to REC and
`end_date` from the market-data range); auto-trace still fires with no click (additive proof);
Enter-in-field dispatches once; Enter no-ops while pending; loading renders (button disabled,
spinner swaps the label); error message renders with no chart; non-`Error` rejection falls back to
the generic message.

**Screenshots** (`docs/session-pnl-run/`, headless Chromium against a private `:3009` dev server
proxying to the live fixed `:8000` backend; `:3000`/`:8000` untouched):
`run-disabled.png` (fresh panel, maturity empty → dimmed RUN), `run-idle-first-trace.png`
(the 2021-07-05 → 2026-07-05 / 3% / 100억 / PAY fixture traced, RUN idle — final cumulative
+564,960,000 KRW as of 2026-07-03, served by the S6-corrected engine), `run-loading.png` (spinner
during a route-delayed request after editing IRS Rate 3 → 3.25), `run-rerun-success.png` (the
successful rerun after that edit), `run-error.png` (route-forced 500 → "simulated backend failure"
rendered in the chart area).

## 5. Notes for the integration pass

- Fork point `777fd00` — same mainline tip as `s7/chart-colors` and `s8/branding`; this branch's
  only source-file overlap risk is `pnl-trace-panel.tsx` **if** s7 recolors the marker/series
  literals in the same file — the hunks are disjoint (mine: imports/form/error JSX; theirs: chart
  effect region), so a textual merge should be clean or trivially resolvable.
- The `useNpvTrace` mutation and API contract are unchanged; no new dependencies were added.
