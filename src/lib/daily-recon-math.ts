/**
 * RECON-DAILY / FB3 — pure arithmetic for the 일별 대사 panel.
 *
 * Core rule (owner-fixed FB3 bridge, not re-derivable): the footer is a
 * bridge LADDER,
 *   테타 (T−1 기지값) → + Assumed (Σ KRD@D−1 × (−Δbp)) → = 예상 PnL
 *     → vs Realized (테타 + 채권평가 + 스왑평가) → 잔차 (컨벡시티+베이시스)
 * The terms are mutually exclusive and collectively account for the compared
 * bucket (theta + valuation, funding excluded): 예상 − 테타 ≡ Assumed and
 * Realized − 예상 ≡ 잔차 hold exactly (±₩1 pinned). 펀딩 stays an
 * engine-supplied chip OUTSIDE the comparison — FB3 diagnosis confirmed it is
 * a separate response field, never inside mtm/theta.
 *
 * SIGN (FB3 Phase-1 finding, the +705% residual's primary cause): first-order
 * P&L per cell is KRD × (−Δbp) — the SAME convention the realized buckets
 * use (backend `_bond_pnl`: mtm = pvbp×(−dy_bp); simulate aggregates:
 * "MTM = pvbp * (-sbp)"; long DV01 loses when yields rise). The previous
 * KRD × (+Δbp) inverted the Assumed leg: on 2026-07-14 (live-reproduced)
 * the swap grid said +218.1M vs realized −219.8M — sign-corrected, the swap
 * 잔차 is −1.7M. See FB3_RECON_REPORT.md for the full decomposition.
 *
 * Everything here is pure and fixture-testable (daily-recon-math.test.ts).
 * The component (features/home/daily-recon-panel.tsx) does no arithmetic of
 * its own — both mounts render these functions' outputs, so two mounts can
 * never disagree about the same date.
 */
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { DailyPnlFigures, MarketDataResponse, PortfolioCashFlowOut } from "@/lib/api-types";

/** The residual slot's label. Exported so the naming pin can assert on the
 * single source: the residual is 잔차 — captioned 컨벡시티(+베이시스), which
 * FB3 measured as credit-vs-swap-pillar basis + workbook-PVBP grain (true
 * convexity ≈ ₩0 at single-digit-bp moves). It must never be renamed into a
 * carry/theta word — 테타 is its own LADDER RUNG (the T−1 기지값), a
 * different term of the bridge, not a name for the residual. */
export const RESIDUAL_LABEL = "잔차";

/** The residual's fixed caption (owner spec). */
export const RESIDUAL_CAPTION = "컨벡시티(+베이시스)";

/** KRD tenor column → market pillar available in a MarketDataResponse
 * snapshot. EXACT matches only (no interpolated risk):
 *   1D  ← on_rate (usually absent → unmapped)
 *   3M  ← cd_rate (CD91D; the same mapping build_pvbp_sensitivity applies to
 *         the CD91D delta pillar, portfolio_analytics_service.py:176)
 *   6M/9M/1.5Y ← swap quote with tenor_months 6/9/18
 *   1Y..10Y, 30Y ← whole-year swap quote (tenor_months null)
 * Snapshot quotes with no KRD column (11Y/12Y/15Y/20Y/25Y) are ignored; KRD
 * columns with no pillar at BOTH dates are unmapped (null Δbp) and must be
 * EXCLUDED from Σ with a visible note, never zero-filled.
 */
export function pillarRates(snapshot: MarketDataResponse): Record<string, number> {
  const rates: Record<string, number> = {};
  if (snapshot.on_rate != null) rates["1D"] = snapshot.on_rate;
  rates["3M"] = snapshot.cd_rate;
  for (const q of snapshot.swap_quotes) {
    if (q.tenor_months != null) {
      if (q.tenor_months === 6) rates["6M"] = q.rate;
      else if (q.tenor_months === 9) rates["9M"] = q.rate;
      else if (q.tenor_months === 18) rates["1.5Y"] = q.rate;
      // Other sub-year months: no KRD column — ignored, not guessed.
    } else if (q.tenor_years >= 1 && q.tenor_years <= 10) {
      rates[`${q.tenor_years}Y`] = q.rate;
    } else if (q.tenor_years === 30) {
      rates["30Y"] = q.rate;
    }
  }
  return rates;
}

/** Δbp per KRD column, close(D−1) → close(D). null = unmapped (pillar absent
 * at either date) — "we don't know", which is different from 0 ("didn't
 * move") and must stay null all the way to the screen. */
export function deltaBpByTenor(
  columns: readonly string[],
  closeSnapshot: MarketDataResponse,
  asOfSnapshot: MarketDataResponse,
): Record<string, number | null> {
  const close = pillarRates(closeSnapshot);
  const asOf = pillarRates(asOfSnapshot);
  const out: Record<string, number | null> = {};
  for (const c of columns) {
    out[c] =
      close[c] != null && asOf[c] != null ? (asOf[c] - close[c]) * 10_000 : null;
  }
  return out;
}

export interface ContributionRow {
  sector: string;
  /** ₩ per column; null = unmapped tenor (excluded from the row total). */
  cells: Record<string, number | null>;
  /** Σ over MAPPED columns only. */
  total: number;
}

/** M3 = M1 × M2 cell-wise: contribution_₩[sector][tenor] =
 * KRD@D−1[sector][tenor] × (−Δbp[tenor]) — the first-order P&L convention
 * the realized buckets themselves use ([CHANGED, FB3] sign fix; see module
 * header — the old ×(+Δbp) inverted the whole Assumed leg).
 *
 * null-vs-0 (FB5-A A3.4): a cell is null — reserved for "—" — in exactly two
 * cases, unmapped Δbp (we don't know the move) OR no KRD mass at that tenor
 * (nothing to move). A cell where KRD IS present and Δbp is a real 0.0 is an
 * honest ₩0 (a measurement: risk existed, the rate didn't move) and stays a
 * numeric 0 so the matrix renders 0, not — (paired with zeroAsDash={false} on
 * the M3 grid). A 0-KRD cell contributes 0 to the sum either way, so the Σ /
 * Assumed figure is byte-identical to the pre-A3.4 behavior. */
export function contributionRows(
  columns: readonly string[],
  pvbpRows: Array<Record<string, unknown>>,
  deltaBp: Record<string, number | null>,
): ContributionRow[] {
  return pvbpRows.map((row) => {
    const cells: Record<string, number | null> = {};
    let total = 0;
    for (const c of columns) {
      const krd = typeof row[c] === "number" ? (row[c] as number) : 0;
      const d = deltaBp[c];
      if (d == null || krd === 0) {
        cells[c] = null; // unmapped Δbp, or no KRD mass — both render —
      } else {
        // krd ≠ 0: a real contribution. d === 0 is an honest ₩0 (normalize the
        // JS −0 that krd × -0 produces so it prints as "0").
        const v = d === 0 ? 0 : krd * -d;
        cells[c] = v;
        total += v;
      }
    }
    return { sector: String(row.sector), cells, total };
  });
}

/** Tenors excluded from Σ (unmapped Δbp) that carry NON-ZERO KRD mass on the
 * 합계 row — the ones the visible exclusion note must name. A tenor with no
 * mass and no pillar is silent (nothing was excluded). */
export function excludedTenors(
  columns: readonly string[],
  totalPvbpRow: Record<string, unknown> | undefined,
  deltaBp: Record<string, number | null>,
): Array<{ tenor: string; krd: number }> {
  if (!totalPvbpRow) return [];
  const out: Array<{ tenor: string; krd: number }> = [];
  for (const c of columns) {
    const krd = typeof totalPvbpRow[c] === "number" ? (totalPvbpRow[c] as number) : 0;
    if (deltaBp[c] == null && krd !== 0) out.push({ tenor: c, krd });
  }
  return out;
}

/** FB3 — the bridge ladder's five terms. Identities (pinned ±₩1):
 * expected ≡ theta + assumed; realized ≡ theta + bondMtm + swapMtm;
 * residual ≡ realized − expected (≡ (bondMtm+swapMtm) − assumed). */
export interface BridgeLadder {
  /** T−1 기지값 — the engine's deterministic pre-open P&L (Total row theta:
   * bond accrued roll + swap leg theta + windowed settlement cash). */
  theta: number;
  /** Σ_tenor 합계KRD@D−1 × (−Δbp) over mapped tenors. */
  assumed: number;
  /** 테타 + Assumed — the ladder's 예상 PnL. */
  expected: number;
  /** 테타 + 채권평가 + 스왑평가 (the compared bucket; funding excluded). */
  realized: number;
  /** realized − expected — 잔차 (컨벡시티+베이시스). */
  residual: number;
  /** residual as a share of |realized|; null when realized == 0. */
  residualPct: number | null;
}

/** The realized side of the comparison, or the honest reason there isn't
 * one. A class ABSENT from the book contributes 0 (a fact: no positions); a
 * class whose mtm is null or partial makes the whole footer unknowable —
 * never a partial value presented as the realized total. Shared by the
 * single-date footer and the range strip so both mounts apply one rule. */
export function realizedFromByClass(byClass?: {
  bond?: DailyPnlFigures;
  swap?: DailyPnlFigures;
}): { bondMtm: number; swapMtm: number } | { disabledReason: string } {
  const classes = [
    { label: "채권평가", cls: byClass?.bond },
    { label: "스왑평가", cls: byClass?.swap },
  ];
  for (const { label, cls } of classes) {
    if (cls && (cls.mtm === null || !cls.mtm_complete)) {
      return {
        disabledReason: `실현 ${label}이 미완성입니다 (호가 미도착) — 부분값으로 ${RESIDUAL_LABEL}를 만들지 않습니다.`,
      };
    }
  }
  return {
    bondMtm: byClass?.bond?.mtm ?? 0,
    swapMtm: byClass?.swap?.mtm ?? 0,
  };
}

/** The Assumed figure: the 합계 row's contribution total (Σ over MAPPED
 * tenors of KRD@D−1 × Δbp). undefined when the response has no 합계 row. */
export function assumedTotal(
  columns: readonly string[],
  pvbpRows: Array<Record<string, unknown>>,
  deltaBp: Record<string, number | null>,
): number | undefined {
  const rows = contributionRows(columns, pvbpRows, deltaBp);
  return rows.find((r) => r.sector === "합계")?.total;
}

/** FB5-A A3.2/A3.3 — the DV01-FIX basis metadata the pvbp-sensitivity 합계 row
 * carries (portfolio_analytics_service.build_pvbp_sensitivity): how the bond
 * KRD cells were derived, and the blotter snapshot's own as-of.
 *
 *  - `sources`: additive counts keyed by the engine's own source names —
 *    `reval` (bump-reval DV01 at D−1), `sheet_frn` (reset-linked sheet
 *    duration; the FRN carve-out), `sheet_fallback` (sheet PVBP for rows the
 *    engine could not revalue). Renders the mixed basis explicit.
 *  - `blotterAsOf`: the frozen blotter's detected as-of (uniform 잔존일수
 *    fingerprint; 2026-03-23 in the current export, ≈ D on a fresh one). */
export interface Dv01Meta {
  sources: Record<string, number>;
  blotterAsOf: string | null;
  frnCount: number;
}

/** Human labels for the engine's dv01 source keys (A3.3 chip). */
export const DV01_SOURCE_LABELS: Record<string, string> = {
  reval: "reval",
  sheet_frn: "FRN",
  sheet_fallback: "fallback",
};
/** Chip render order — the primary basis first, then the carve-outs. */
export const DV01_SOURCE_ORDER = ["reval", "sheet_frn", "sheet_fallback"] as const;

/** Pull the DV01-FIX basis metadata off the pvbp-sensitivity 합계 row. Absent
 * fields (fresh export before the DV01 line, or a book with no bonds) degrade
 * to empty/nulls — the caller hides the chips rather than inventing them. */
export function dv01Meta(pvbpRows?: Array<Record<string, unknown>>): Dv01Meta {
  const total = pvbpRows?.find((r) => r.sector === "합계");
  const rawSources = total?.dv01_sources;
  const sources: Record<string, number> = {};
  if (rawSources && typeof rawSources === "object") {
    for (const [k, v] of Object.entries(rawSources as Record<string, unknown>)) {
      if (typeof v === "number") sources[k] = v;
    }
  }
  const blotterAsOf = typeof total?.blotter_as_of === "string" ? total.blotter_as_of : null;
  const frn = total?.frn_positions;
  const frnCount = Array.isArray(frn) ? frn.length : sources["sheet_frn"] ?? 0;
  return { sources, blotterAsOf, frnCount };
}

/** A3.2 — the blotter is "stale" (worth an honest as-of notice) when its
 * detected snapshot date lags the reconciliation reference (the D−1 close the
 * KRD was priced at) by more than this many calendar days. On a fresh export
 * the detected as-of ≈ the reference and the notice stays hidden. */
export const BLOTTER_STALE_THRESHOLD_DAYS = 7;

/** True when `blotterAsOf` lags `reference` by more than the threshold — the
 * only case the as-of chip surfaces. Null/unparseable → not stale (nothing
 * honest to say). Forward or ≈-reference dates (fresh export) → not stale. */
export function isBlotterStale(
  blotterAsOf: string | null,
  reference: string | null,
  thresholdDays: number = BLOTTER_STALE_THRESHOLD_DAYS,
): boolean {
  if (!blotterAsOf || !reference) return false;
  const lag = differenceInCalendarDays(parseISO(reference), parseISO(blotterAsOf));
  return Number.isFinite(lag) && lag > thresholdDays;
}

/** T4a — scheduled swap net settlements in the window (close, asOf], from a
 * price response's cashflow schedule (priced off the CLOSE snapshot, so
 * payments inside the window are still on the schedule and their floating
 * amounts are the D−1-known fixings — s6/s10 conventions, `is_known`).
 *
 * Sign mirrors the engine's _realized_swap_cash exactly: CashFlowDetail
 * amounts are unsigned per leg; receive-fixed nets fixed − floating,
 * pay-fixed the reverse. A cashflow with a null amount (unknown future
 * fixing) inside the window would make the net unknowable — flagged rather
 * than skipped, because skipping would silently understate the settlement. */
export function netSwapSettlements(
  cashflows: PortfolioCashFlowOut[],
  payFixedById: Record<string, boolean>,
  close: string,
  asOf: string,
): { totalNet: number; byPosition: Record<string, number>; unknownCount: number } {
  const byPosition: Record<string, number> = {};
  let totalNet = 0;
  let unknownCount = 0;
  for (const cf of cashflows) {
    if (!(cf.payment_date > close && cf.payment_date <= asOf)) continue;
    if (cf.cashflow == null) {
      unknownCount += 1;
      continue;
    }
    const receiveFixed = !payFixedById[cf.position_id];
    const sign = (cf.leg === "fixed") === receiveFixed ? 1 : -1;
    const amt = sign * cf.cashflow;
    byPosition[cf.position_id] = (byPosition[cf.position_id] ?? 0) + amt;
    totalNet += amt;
  }
  return { totalNet, byPosition, unknownCount };
}

/** s11 tolerance: the daily identity holds to within ₩1 at position and
 * aggregate level, so scheduled-vs-realized settlement equality uses the
 * same bound. */
export const SETTLEMENT_TOLERANCE_KRW = 1;

/** FB3 ladder arithmetic. Callers must only invoke this when BOTH realized
 * valuation buckets are known and complete — an unknown bucket disables the
 * footer with an honest message instead (component responsibility, pinned
 * there). A class genuinely absent from the book (no swaps) contributes 0,
 * which is a different fact from "unknown" and is the caller's distinction
 * to make. Theta is always deterministic (T−1 기지값) so it carries no
 * completeness state of its own. */
export function bridgeLadder(
  theta: number,
  assumed: number,
  bondMtm: number,
  swapMtm: number,
): BridgeLadder {
  const expected = theta + assumed;
  const realized = theta + bondMtm + swapMtm;
  const residual = realized - expected;
  return {
    theta,
    assumed,
    expected,
    realized,
    residual,
    residualPct: realized !== 0 ? (residual / Math.abs(realized)) * 100 : null,
  };
}
