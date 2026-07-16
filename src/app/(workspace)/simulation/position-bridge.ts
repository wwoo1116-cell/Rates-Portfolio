/**
 * S6 — input bridge (app layer). Maps the target's real ledgers — bonds
 * (useBondPositionsStore) AND swaps (useManualPositionsStore, s15 T2) — into
 * the simulation slice's SimulationInputs.positions. Lives at the app layer
 * (it reads app stores), keeping the slice pure.
 *
 * Every risk-bearing field (pvbp, duration, entryYield, evaluationAmount, couponRate)
 * comes from REAL store data — nothing is fabricated. Amounts convert 억(1e8)→원 to
 * match the source's WON convention (its evaluationAmount ÷1e8 renders as 억).
 *
 * Swaps (s15 T2): ManualPosition carries the CONTRACT terms (start/maturity/
 * fixed rate/direction/notional); every market-derived field is resolved by the
 * backend, not fabricated here — pvbp/krdMap/theta via enrich_irs_pvbp, the
 * current-period CD fixing + next fixing date via the fixing store
 * (simulation_service._resolve_swap_float_fields), and the par curve from the
 * backend's IRS snapshot store for the base date. If the base date has no IRS
 * quotes the backend EXCLUDES swaps explicitly (response.exclusions) instead of
 * pricing them off a stale snapshot or emitting silent zeros.
 *
 * Funding (s15 T1): the request deliberately carries NO fundingRate. The
 * backend derives funding as its 기준금리+10bp constant — the single source the
 * funding strip, header carry chip, and Total Return carry math all consume.
 * (The previous hardcoded 0.042 here was the source project's stub and matched
 * no real rate — the live header's "Funding 4.20%" traced back to this line.)
 *
 * KNOWN GAPS (documented, not faked):
 *  - dailyShockCurves was a separate Excel upload in the source; the target has
 *    no equivalent, so it's sent empty (drives only "당일 실제 금리변동").
 */
import type { BondPosition } from "@/stores/bond-positions-store";
import type { ManualPosition } from "@/stores/manual-positions-store";
import type { Position, SimulationInputs } from "@/features/simulation";

/** BondPosition → simulation-domain Position (bondType 'bond', long/direction +1). */
export function bondToSimPosition(b: BondPosition): Position {
  return {
    id: b.id,
    name: b.name,
    book: b.book,
    bondType: "bond",
    sector: b.sector as Position["sector"],
    maturityDate: b.maturityDate,
    couponRate: b.couponRate,
    frequency: b.paymentFrequency,
    notional: b.notionalKrwEok * 1e8,
    entryYield: b.entryYield,
    entryYieldPurchase: b.entryYield,
    mtmYield: b.mtmYield,
    evaluationAmount: b.evaluationAmountKrwEok * 1e8,
    duration: b.duration,
    pvbp: b.pvbp,
    tenor: b.tenorBucket,
    remainingDays: b.remainingDays,
    durationWeight: 0,
    krdMap: {},
    direction: 1,
    startDate: b.issueDate,
  };
}

/** ManualPosition (IRS ledger) → simulation-domain Position (bondType 'swap').
 * Contract terms only; market fields (pvbp/krdMap/fixing/next fixing date)
 * stay unset for the backend to resolve — see module docstring. remainingDays
 * is calendar days to maturity from `baseDate` (the same clock the backend's
 * FM path ages the trade on). */
export function swapToSimPosition(m: ManualPosition, baseDate: string): Position {
  const remainingDays = Math.max(
    Math.round((Date.parse(m.maturityDate) - Date.parse(baseDate)) / 86400000),
    0,
  );
  return {
    id: m.id,
    name: m.name,
    book: m.book,
    bondType: "swap",
    sector: (m.sector === "OIS" ? "OIS" : "IRS") as Position["sector"],
    maturityDate: m.maturityDate,
    couponRate: m.fixedRate,
    frequency: 4,
    notional: m.notionalKrwEok * 1e8,
    entryYield: 0,
    entryYieldPurchase: 0,
    evaluationAmount: 0,
    duration: 0,
    pvbp: 0,
    tenor: "",
    remainingDays,
    durationWeight: 0,
    krdMap: {},
    // Backend convention: +1 = receive-fixed, −1 = pay-fixed.
    direction: m.payFixed ? -1 : 1,
    currentFloatRate: 0,
    startDate: m.startDate,
  };
}

/** Assemble the full ambient inputs the simulation port consumes. */
export function buildSimulationInputs(
  bonds: BondPosition[],
  swaps: ManualPosition[] = [],
): SimulationInputs {
  const baseDate = new Date().toISOString().slice(0, 10);
  return {
    positions: [
      ...bonds.map(bondToSimPosition),
      ...swaps.filter((m) => Date.parse(m.maturityDate) > Date.parse(baseDate)).map((m) => swapToSimPosition(m, baseDate)),
    ],
    baseDate,
    dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    // Par rates resolved by the backend from its IRS snapshot store (s15 T2).
    irsParRates: [],
  };
}
