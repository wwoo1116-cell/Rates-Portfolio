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

export type SelectedInstrument =
  | { kind: "outright"; id: string; leg: Leg }
  | { kind: "spread"; id: string; legA: Leg; legB: Leg };

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

export function spreadId(a: Leg, b: Leg): string {
  return `S:${legKey(a)}~${legKey(b)}`;
}

export function instrumentLabel(inst: SelectedInstrument): string {
  return inst.kind === "outright"
    ? legLabel(inst.leg)
    : `${legLabel(inst.legB)} − ${legLabel(inst.legA)}`; // "B − A" reads as the spread's sign
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
    else {
      add(inst.legA);
      add(inst.legB);
    }
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
 * ((legB − legA) × 10000, only on dates where BOTH legs have a value) on the
 * left axis.
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
    const aVals = legValueMap(inst.legA, irsPoints, creditByKey);
    const bVals = legValueMap(inst.legB, irsPoints, creditByKey);
    const lineData: { time: string; value: number }[] = [];
    for (const [date, a] of aVals) {
      const b = bVals.get(date);
      if (b != null) lineData.push({ time: date, value: (b - a) * 10000 });
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
