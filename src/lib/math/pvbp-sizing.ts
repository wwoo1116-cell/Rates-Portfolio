/**
 * PVBP sizing for an N-leg RV spread package (B4).
 *
 * WHY THE PVBP IS APPROXIMATED: an RV leg is a curve point ("국고채 3Y", "IRS 5Y"),
 * not a booked position, so there is no engine-computed pvbp to read -- the
 * backend's pvbp field only exists for real book positions. Each leg's PVBP is
 * therefore derived from the two things we do have at the selected date: its
 * tenor and its yield.
 *
 * SIZING CONVENTION (the tooltip in spread-position-panel.tsx states this too):
 * fixing one anchor leg and demanding net PVBP = 0 is underdetermined for a
 * 3-leg fly, so the spread's own weights supply the missing shape constraint.
 * But holding nᵢ ∝ wᵢ exactly is *inconsistent* with PVBP neutrality --
 *
 *     net PVBP = Σ nᵢ·pᵢ = k·Σ wᵢ·pᵢ = 0  ⟹  k = 0
 *
 * -- i.e. the only package matching the raw weight ratios AND neutrality is the
 * empty one. The resolution is the standard PVBP-weighted convention: the
 * weights describe the expression being traded, and each leg is scaled by its
 * own PVBP to express it:
 *
 *     nᵢ = c · wᵢ / pᵢ      ⟹   net PVBP = Σ (c·wᵢ/pᵢ)·pᵢ = c · Σ wᵢ
 *
 * So the package is PVBP-neutral exactly when the weights cancel (Σwᵢ = 0),
 * which holds for both a (+1,−1) spread and a (+1,−2,+1) fly. The anchor fixes
 * c. Weights that don't sum to zero cannot be made neutral at any non-zero
 * scale, and the caller is expected to surface that rather than silently
 * returning a non-zero residual.
 */

/** "3Y" -> 3, "3M" -> 0.25, "1.5Y" -> 1.5, "18M" -> 1.5. Null if unparseable. */
export function parseTenorYears(tenor: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([YM])$/i.exec(tenor.trim());
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return m[2].toUpperCase() === "Y" ? value : value / 12;
}

/**
 * Modified duration of a par instrument at `tenorYears` with decimal yield `y`:
 *
 *     D = (1 − (1+y)^−T) / y
 *
 * This is the par-bond/annuity form (it is also the swap annuity, so it serves
 * IRS legs too). Sanity: T=10, y=4% -> 8.11, which matches a 10Y par bond.
 *
 * As y -> 0 the expression is 0/0 and tends to T, so near-zero and negative-ish
 * yields fall back to T rather than exploding.
 */
export function approxModifiedDuration(tenorYears: number, yieldDecimal: number): number {
  if (!(tenorYears > 0)) return 0;
  // Below this the floating-point cancellation in (1 − (1+y)^−T) dominates and
  // the limit D -> T is the better answer anyway.
  if (Math.abs(yieldDecimal) < 1e-6) return tenorYears;
  if (yieldDecimal <= -1) return tenorYears; // (1+y) non-positive: formula undefined
  return (1 - Math.pow(1 + yieldDecimal, -tenorYears)) / yieldDecimal;
}

/** Currency PVBP per 1 unit of notional, per 1bp of yield. */
export function pvbpPerUnitNotional(tenorYears: number, yieldDecimal: number): number {
  return approxModifiedDuration(tenorYears, yieldDecimal) * 1e-4;
}

export interface SizingLeg {
  /** Display label, e.g. "IRS 5Y". */
  label: string;
  /** Signed weight from the spread expression. */
  weight: number;
  /** PVBP per unit notional at the selected date (pvbpPerUnitNotional). */
  pvbpUnit: number;
}

export interface SizedLeg extends SizingLeg {
  /** Solved (or user-entered) notional. Negative = short. */
  notional: number;
  /** notional × pvbpUnit — the leg's currency PVBP, signed. */
  pvbp: number;
}

export interface SizingResult {
  legs: SizedLeg[];
  /** Σ legs.pvbp. ~0 for a PVBP-neutral solve with Σweights = 0. */
  netPvbp: number;
  /** Set when the package cannot be made neutral (Σweights ≠ 0, or a
   * degenerate anchor). The caller shows this instead of a bogus solve. */
  warning?: string;
}

export function sumWeights(legs: Pick<SizingLeg, "weight">[]): number {
  return legs.reduce((acc, l) => acc + l.weight, 0);
}

function withPvbp(legs: SizingLeg[], notionals: number[]): SizedLeg[] {
  return legs.map((l, i) => ({ ...l, notional: notionals[i], pvbp: notionals[i] * l.pvbpUnit }));
}

/** MANUAL mode: the user owns every notional; we only report the resulting PVBP. */
export function sizeManual(legs: SizingLeg[], notionals: number[]): SizingResult {
  const sized = withPvbp(legs, legs.map((_, i) => notionals[i] ?? 0));
  return { legs: sized, netPvbp: sized.reduce((a, l) => a + l.pvbp, 0) };
}

/**
 * PVBP-NEUTRAL mode: nᵢ = c·wᵢ/pᵢ, with c fixed by the anchor leg's notional.
 * Works identically for N=2 and N=3 (B3's generalized leg array).
 */
export function sizePvbpNeutral(
  legs: SizingLeg[],
  anchorIndex: number,
  anchorNotional: number,
): SizingResult {
  const anchor = legs[anchorIndex];
  if (!anchor) return { legs: withPvbp(legs, legs.map(() => 0)), netPvbp: 0, warning: "앵커 레그가 없습니다." };
  if (anchor.weight === 0 || anchor.pvbpUnit === 0) {
    return {
      legs: withPvbp(legs, legs.map(() => 0)),
      netPvbp: 0,
      warning: "앵커 레그의 가중치 또는 PVBP가 0이라 스케일을 결정할 수 없습니다.",
    };
  }

  // nₐ = c·wₐ/pₐ = anchorNotional  ⟹  c = anchorNotional·pₐ/wₐ
  const c = (anchorNotional * anchor.pvbpUnit) / anchor.weight;
  const notionals = legs.map((l) => (l.pvbpUnit === 0 ? 0 : (c * l.weight) / l.pvbpUnit));
  const sized = withPvbp(legs, notionals);
  const netPvbp = sized.reduce((a, l) => a + l.pvbp, 0);

  const wSum = sumWeights(legs);
  const warning =
    Math.abs(wSum) > 1e-9
      ? `가중치 합이 ${wSum} (≠ 0)이라 PVBP 중립이 불가능합니다 — net PVBP는 가중치 합에 비례합니다.`
      : undefined;

  return { legs: sized, netPvbp, warning };
}

/**
 * Strategy P&L from the entry date, in currency.
 *
 * A long position loses when its yield rises, so per leg
 *   P&Lᵢ(t) = −pvbpᵢ · Δyᵢ(t)_bp
 * and the package P&L is their sum. With net PVBP = 0 a parallel shift cancels
 * out, which is the whole point of the neutral sizing — what survives is the
 * curve/spread move.
 *
 * Only dates where EVERY leg has a yield are emitted, matching
 * buildInstrumentSeries' all-legs-or-nothing rule.
 */
export function spreadPnlPath(
  legs: SizedLeg[],
  /** Per-leg date -> decimal yield, in the same order as `legs`. */
  legYields: Map<string, number>[],
  entryDate: string,
): { time: string; value: number }[] {
  const entryYields = legs.map((_, i) => legYields[i]?.get(entryDate));
  if (entryYields.some((y) => y == null)) return [];

  const [driver] = legYields;
  if (!driver) return [];

  const out: { time: string; value: number }[] = [];
  for (const date of driver.keys()) {
    if (date < entryDate) continue;
    let pnl = 0;
    let complete = true;
    for (let i = 0; i < legs.length; i++) {
      const y = legYields[i]?.get(date);
      if (y == null) {
        complete = false;
        break;
      }
      const deltaBp = (y - (entryYields[i] as number)) * 10000;
      pnl += -legs[i].pvbp * deltaBp;
    }
    if (complete) out.push({ time: date, value: pnl });
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}
