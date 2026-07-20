# DEMO_DEBT — remaining OWNER-DECISION items (post HARDEN-1, 2026-07-20)

The demo-sprint debt list (11 entries) was walked in HARDEN-1. Everything
fixable was fixed (disposition table in HARDEN1_REPORT.md); what remains below
are the items that need an owner call, each with why it is a decision and not
a fix.

## OD-1. Time-path preview: revive or delete `lib/scenario-preview.ts`
The 국채 3Y bp time-path view (waypoint feedback) has been unrendered since the
demo two-pane rebuild; the lib + its tests are intact and dead. The waypoint
editor in 고급 설정 still exists, so a path preview has UX value — but whether
it returns (e.g. as a Configure sub-view) or the lib is deleted is a product
call, not a code fix.

## OD-2. Input-curve preview fidelity: par+shock vs true bootstrap
The two-pane preview draws base par quotes + the interpolated horizon-end
shock (pure client math, instant). A truthful ZERO-curve shape would need the
light `POST /api/curve` per baseDate/spread change — a latency/fidelity
trade-off the owner should rule on before we add network chatter to every
slider move.

## OD-3. Data edge: 국고채 series lags IRS by one day
As of the sprint, IRS market-data reaches 2026-07-16 but the 국고채
credit-curve series ends 2026-07-15, so the latest quoted date renders IRS-only
(blank policy, correct display). The fix is in the data pipeline (Credit
Matrix ingestion cadence), not the FE/BE code.

## OD-4. Entry Signals revival timing
ES stays hidden (nav item commented in `src/lib/constants.ts`, route 404s via
`app/(workspace)/entry-signals/page.tsx`; slice/store/tests untouched; Cmd+1~6
shortcuts shift one slot while hidden). Revival is explicitly out of scope
until the owner schedules it; restore = uncomment the nav line + icon import,
revert the page file.
