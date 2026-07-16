# REPORT — s16: Daily P&L by Book Column Misalignment

- **Branch / worktree:** `s16/daily-pnl-columns` in `wt-s14-fe`, off `s14/chart-polish` head `6b3d091` (serial FE order s14 → s16). NOT merged.
- **Scope kept:** one component + its test. Zero files under `src/features/simulation/`; zero backend/valuation changes. Display-only: the fix touches a tooltip wrapper's layout mode and td alignment — every displayed numeric is byte-identical (verified live: same `-314,563` / `0` values before and after, `docs/session-s16/`).

## Gates (all green at HEAD)

| Gate | Result |
|---|---|
| vitest | **172/172** (s14 baseline 169 + 3 s16 additions), 23 files — all guards included |
| tsc --noEmit | clean |
| next build | clean (13/13 pages) |
| eslint | clean on both touched files; repo baseline unchanged |

## Task 1 — Diagnosis (hypothesis REFUTED)

The working hypothesis — blank MtM renders `null`/fragment and the cell loses its slot — is **wrong**. DOM dump of the live partial state (`docs/session-s16/dom-before.html`, captured headlessly against this branch pre-fix) shows every row has all five `<td>`s with the correct content in the correct order: `[Trading][-314,563][—][-314,563‡][0]`. Column identity was never structurally broken.

**Actual mechanism:** Blueprint `Tooltip` wraps its child in a shrink-to-fit inline target (`<span class="bp5-popover-target">`, default `targetTagName="span"`). The cell content spans (`KrwCell`/`UnknownCell`) align themselves via `display:block; text-align:right` — which works when they are the td's direct child (block fills the fixed-layout column), but inside the tooltip's shrink-wrapped inline span the block's containing width collapses to the text width, and the whole thing parks at the td's **left** edge (td default `text-align:left`).

Only tooltip-wrapped cells are affected, and tooltips exist **only in the partial state** (the blank-MtM `—` and the partial `‡`-Total; complete-day cells render bare spans). So in a partial row: Theta (bare, right-aligned) abuts the left-parked `—` of the next column → reads as `+270.1M—` in one cell; the left-parked `‡`-Total sits directly under the right-aligned "MTM" header text → reads as MtM's value; Total's right region is empty; Funding (bare) is fine. A perfect one-column-left illusion with a structurally correct DOM — and exactly why complete-day fixtures never caught it: the offending wrapper doesn't exist on complete days.

## Task 2 — Fix (`book-daily-pnl-table.tsx`)

1. `fill` on both in-cell Tooltips (`KrwCell`'s tooltip branch, `UnknownCell`). Blueprint's `fill` renders the target as a block-level `<div>` spanning the td (and stamps `bp5-fill` on the cloned child), restoring the inner span's right alignment. Verified in the Blueprint 5 source: `if (fill) targetTagName = "div"` + `Classes.FILL` on the child.
2. `text-right` on all four numeric `<td>`s — alignment is now the **column's** property, so any future shrink-wrapped child still lands at the right edge of its own column instead of manufacturing a shift.
3. `‡` referent confirmed: the suffix renders inside the Total cell's `KrwCell` and the footnote text names the stale sources; both pinned by test.
4. Both the per-book row and the Total row go through the same row renderer, so the fix covers both (asserted per-row in the tests).

The ribbon tooltips (`PeriodPnlStat`, `QuoteSourceRibbon` ⌛) are deliberately left inline — they live in flex/inline text contexts where shrink-to-fit is the intended behavior.

## Task 3 — Sweep (same pattern elsewhere)

Searched every non-Simulation `Tooltip` consumer and every `—` fallback:

| Surface | Pattern | Verdict |
|---|---|---|
| PVBP Sensitivity table (`pvbp-sensitivity-table.tsx`) | `—` for zero buckets, always inside an always-present `display:block; text-align:right` span, direct td child, no tooltip wrapper | clean |
| Portfolio details CashflowTable + fields (`details-panel.tsx`) | `—` as plain td text with td-level `text-right` classes | clean |
| Positions grid / Entry Signals signal & trades grids (ag-grid `signal-columns.tsx`, `trades-columns.tsx`) | `—` from valueFormatters/renderers inside ag-grid-owned cell boxes | clean |
| PnL Trace panel (`pnl-trace-panel.tsx`) | `—` in flex rows; "Tooltip" is a native `title` attr + custom floating div, no Blueprint wrapper in cells | clean |
| Period ribbon + quote-source ribbon (same file as the fix) | Blueprint Tooltips in inline/flex contexts (not table slots) | clean, intended |
| `constraints-form.tsx` (Optimal) | Tooltip wraps the submit button, not a cell | clean |
| `components/ui/tooltip.tsx` / `tooltip-compat.tsx` | compat shims render bare fragments (no wrapper element at all); no table consumers | clean |
| `settings-workspace.tsx`, `backtest-panel.tsx`, `spread-position-panel.tsx` badges | `—` in stat/flex readouts | clean |

No other surface combines a Blueprint Tooltip wrapper with a self-aligning block value inside a table slot. The fix therefore stays local to the Daily P&L table.

## Task 4 — Partial-state fixtures (`book-daily-pnl-table.test.tsx`, +3 tests)

New `daily(partial)` builder with **distinct values per column** (a shift in any cell breaks some assertion) and a header-derived column map — cells are addressed as `row.cells[col("MtM")]`, never by reading order:

1. **Complete day:** all five columns populated under their own headers, no `‡`, no footnote.
2. **Partial day:** `Theta` is exactly `+270.1M` (no crammed dash), `MtM` is exactly `—` in its own column, `Total` is exactly `+270.1M‡`, `Funding` `-10.3M` — asserted for **both** the RP Fund and Total rows; footnote names the stale sources.
3. **Mechanism pin:** the MtM/Total tooltip targets must be the block-level fill `DIV` (not Blueprint's default shrink-wrap `SPAN`) with `bp5-fill` on the content, and all four numeric tds must carry `text-right`. A refactor that reverts either mechanism fails this test even though the DOM order would still be correct — which is the trap the original defect exploited.

Task 3 surfaces needed no analogous fixtures: none has the tooltip-in-slot pattern (PVBP's `—` placement is already pinned by its own suite).

## Evidence (`docs/session-s16/`)

- `daily-pnl-before.png` — reproduction on this branch pre-fix (seeded manual IRS position, live backend with no 2026-07-16 quotes): `THETA -314,563—`, `MTM -314,563‡`, `TOTAL` empty.
- `dom-before.html` — the structurally-correct DOM behind that broken paint (the diagnosis artifact).
- `daily-pnl-after.png` — post-fix: `THETA -314,563 | MTM — | TOTAL -314,563‡ | FUNDING 0`, each right-aligned under its own header; identical numerics.
- `dom-after.html` — tooltip targets now `DIV.bp5-popover-target`.

## Out-of-scope confirmations

- The Credit-Matrix-trailing-IRS upload cadence is untouched — no stale-quote fallback was added; blanks stay blank per the honesty rules.
- Simulation directory, backend, other worktrees: untouched.
