/**
 * Instrument model + series-building for the Rates History RV selector.
 *
 * An "instrument" is either an OUTRIGHT (one sector/rating/tenor leg, plotted
 * as a % yield on the right axis) or a SPREAD (leg B minus leg A, plotted in
 * basis points on the left axis, 2-decimal). Legs come from two data sources:
 *   - IRS legs   -> the full /api/rate-history curve (cd_rate + tenor_rates)
 *   - credit legs (국고채/공사채/시은채/여전채/회사채) -> /api/credit-curve/series
 * Both sources carry DECIMAL rates (e.g. 0.0282), so outright display multiplies
 * by 100 for % and spread display multiplies the decimal difference by 10000
 * for bp -- never mixing the two unit conventions.
 */
import type { CreditSeriesResultOut, RateHistoryPointOut } from "@/lib/api-client";
import { colorForId } from "@/lib/chart-colors";

export const IRS_SECTOR = "IRS";

export interface Leg {
  sector: string;
  rating: string | null; // null for unrated sectors (국고채) and IRS
  tenor: string;
}

/** One term of a spread expression: spread = Σ weight·leg. Weights are signed
 * and user-editable; a classic 2-leg spread is (+1 B, −1 A) and a butterfly is
 * (+1, −2, +1). */
export interface SpreadLeg {
  leg: Leg;
  weight: number;
}

export type SelectedInstrument =
  | { kind: "outright"; id: string; leg: Leg }
  | { kind: "spread"; id: string; legs: SpreadLeg[] };

/** Default weights when a leg count is chosen in the selector. N=2 keeps the
 * historical (B − A) sign convention; N=3 defaults to a fly. */
export const DEFAULT_SPREAD_WEIGHTS: Record<number, number[]> = {
  2: [1, -1],
  3: [1, -2, 1],
};

export function legKey(leg: Leg): string {
  return `${leg.sector}|${leg.rating ?? ""}|${leg.tenor}`;
}

/** Human label, e.g. "국고채 3Y", "회사채 AAA (공모) 3Y", "IRS 5Y". */
export function legLabel(leg: Leg): string {
  return [leg.sector, leg.rating ?? "", leg.tenor].filter(Boolean).join(" ");
}

export function outrightId(leg: Leg): string {
  return `O:${legKey(leg)}`;
}

/**
 * Identity of a spread, weights included — two packages over the same legs but
 * different weights (a 1:1 spread vs a 1:2 weighted one) are different
 * instruments and must not collide in the watchlist.
 *
 * NOTE this supersedes the 2-leg-only `S:${legKey(a)}~${legKey(b)}` format;
 * entry-signals-store's persist migration (v1) rewrites old ids through here.
 */
export function spreadId(legs: SpreadLeg[]): string {
  return `S:${legs.map(({ leg, weight }) => `${weight}*${legKey(leg)}`).join("~")}`;
}

/** One term, e.g. "IRS 5Y", "− IRS 3Y", "− 2×국고채 5Y". */
function termLabel({ leg, weight }: SpreadLeg, isFirst: boolean): string {
  const magnitude = Math.abs(weight);
  const coefficient = magnitude === 1 ? "" : `${magnitude}×`;
  if (isFirst) return `${weight < 0 ? "−" : ""}${coefficient}${legLabel(leg)}`;
  return `${weight < 0 ? "−" : "+"} ${coefficient}${legLabel(leg)}`;
}

/** "IRS 5Y − IRS 3Y" for a 2-leg, "국고채 3Y − 2×국고채 5Y + 국고채 10Y" for a fly.
 * The 2-leg rendering is unchanged from the old legA/legB version because the
 * migration stores the +1 leg first (see migrateSpread). */
export function spreadLabel(legs: SpreadLeg[]): string {
  return legs.map((l, i) => termLabel(l, i === 0)).join(" ");
}

export function instrumentLabel(inst: SelectedInstrument): string {
  return inst.kind === "outright" ? legLabel(inst.leg) : spreadLabel(inst.legs);
}

/** All distinct credit (non-IRS) legs referenced by the selected instruments --
 * the leg list to send to /api/credit-curve/series. IRS legs are excluded
 * (resolved from rate-history instead). */
export function creditLegsOf(instruments: SelectedInstrument[]): Leg[] {
  const seen = new Map<string, Leg>();
  const add = (leg: Leg) => {
    if (leg.sector !== IRS_SECTOR) seen.set(legKey(leg), leg);
  };
  for (const inst of instruments) {
    if (inst.kind === "outright") add(inst.leg);
    else for (const { leg } of inst.legs) add(leg);
  }
  return [...seen.values()];
}

function creditKey(sector: string, rating: string | null, tenor: string): string {
  return `${sector}|${rating ?? ""}|${tenor}`;
}

/** date -> decimal value for one leg, from whichever source backs it. */
function legValueMap(
  leg: Leg,
  irsPoints: RateHistoryPointOut[],
  creditByKey: Map<string, Map<string, number>>,
): Map<string, number> {
  if (leg.sector === IRS_SECTOR) {
    const out = new Map<string, number>();
    for (const p of irsPoints) {
      const v = leg.tenor === "3M" ? p.cd_rate : p.tenor_rates?.[leg.tenor];
      if (v != null && Number.isFinite(v)) out.set(p.valuation_date, v);
    }
    return out;
  }
  return creditByKey.get(legKey(leg)) ?? new Map();
}

export interface BuiltSeries {
  id: string;
  kind: "outright" | "spread";
  label: string;
  color: string;
  /** "right" for % outrights, "left" for bp spreads. */
  priceScaleId: "right" | "left";
  /** {time, value}: decimal-% for outrights, bp for spreads. */
  lineData: { time: string; value: number }[];
}

/**
 * Resolve each selected instrument into a plottable series. Outrights carry
 * decimal values (formatted as % on the right axis); spreads carry bp values
 * (Σ weightᵢ·legᵢ × 10000, only on dates where EVERY leg has a value) on the
 * left axis.
 *
 * N=2 and N=3 share this one path: a 2-leg (+1 B, −1 A) evaluates to the same
 * (B − A) × 10000 the hard-coded version produced.
 */
export function buildInstrumentSeries(
  instruments: SelectedInstrument[],
  irsPoints: RateHistoryPointOut[],
  creditResults: CreditSeriesResultOut[],
): BuiltSeries[] {
  const creditByKey = new Map<string, Map<string, number>>();
  for (const r of creditResults) {
    const m = new Map<string, number>();
    for (const p of r.points) m.set(p.valuation_date, p.value);
    creditByKey.set(creditKey(r.sector, r.rating ?? null, r.tenor), m);
  }

  return instruments.map((inst) => {
    if (inst.kind === "outright") {
      const vals = legValueMap(inst.leg, irsPoints, creditByKey);
      const lineData = [...vals.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([time, value]) => ({ time, value }));
      return {
        id: inst.id,
        kind: "outright" as const,
        label: instrumentLabel(inst),
        color: colorForId(inst.id),
        priceScaleId: "right" as const,
        lineData,
      };
    }
    const perLeg = inst.legs.map((l) => ({
      weight: l.weight,
      values: legValueMap(l.leg, irsPoints, creditByKey),
    }));
    const lineData: { time: string; value: number }[] = [];
    // Drive off the first leg's dates, then require every other leg to have a
    // value on that date -- a partially-populated date would silently misprice
    // the spread rather than omit it.
    const [driver, ...rest] = perLeg;
    if (driver) {
      for (const [date, driverValue] of driver.values) {
        let sum = driver.weight * driverValue;
        let complete = true;
        for (const { weight, values } of rest) {
          const v = values.get(date);
          if (v == null) {
            complete = false;
            break;
          }
          sum += weight * v;
        }
        if (complete) lineData.push({ time: date, value: sum * 10000 });
      }
    }
    lineData.sort((x, y) => x.time.localeCompare(y.time));
    return {
      id: inst.id,
      kind: "spread" as const,
      label: instrumentLabel(inst),
      color: colorForId(inst.id),
      priceScaleId: "left" as const,
      lineData,
    };
  });
}
