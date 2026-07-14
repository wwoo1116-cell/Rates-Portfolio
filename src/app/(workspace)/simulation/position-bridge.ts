/**
 * S6 — input bridge (app layer). Maps the target's real bond ledger
 * (useBondPositionsStore) into the simulation slice's SimulationInputs.positions.
 * Lives at the app layer (it reads an app store), keeping the slice pure.
 *
 * Every risk-bearing field (pvbp, duration, entryYield, evaluationAmount, couponRate)
 * comes from REAL store data — nothing is fabricated. Amounts convert 억(1e8)→원 to
 * match the source's WON convention (its evaluationAmount ÷1e8 renders as 억).
 *
 * KNOWN GAPS (documented, not faked):
 *  - IRS/swaps (useManualPositionsStore) are NOT bridged: ManualPosition carries no
 *    pvbp/duration/KRD (those are backend-derived via /api/portfolio/delta), so
 *    including them would understate rate risk. Swap bridging needs that delta output.
 *  - dailyShockCurves + irsParRates were separate Excel uploads in the source; the
 *    target has no equivalent, so they're sent empty (the backend tolerates this —
 *    they drive only the "당일 실제 금리변동" and IRS par-curve features).
 *  - fundingRate defaults to the source's 4.20%; wire a real settings source later.
 */
import type { BondPosition } from "@/stores/bond-positions-store";
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

/** Assemble the full ambient inputs the simulation port consumes. */
export function buildSimulationInputs(bonds: BondPosition[]): SimulationInputs {
  return {
    positions: bonds.map(bondToSimPosition),
    baseDate: new Date().toISOString().slice(0, 10),
    fundingRate: 0.042,
    dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    irsParRates: [],
  };
}
