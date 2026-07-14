/**
 * Manual-position analog of portfolio-request.ts's tradesToPositionsIn/
 * buildPortfolioPriceRequest, for manual-positions-store.ts's ManualPosition[]
 * instead of TradeOut[]. Kept as a separate pair (not folded into
 * buildPortfolioPriceRequest) because that function has other callers
 * (use-portfolio-positions.ts, use-portfolio-risk.ts, Backtest/Simulation)
 * whose TradeOut[]-shaped signature must not change.
 */
import type { MarketDataResponse, PortfolioPositionIn, PortfolioPriceRequest } from "./api-client";
import type { ManualPosition } from "@/stores/manual-positions-store";

export function manualPositionsToPositionsIn(positions: ManualPosition[]): PortfolioPositionIn[] {
  return positions.map((p) => ({
    position_id: p.id,
    start_date: p.startDate,
    maturity_date: p.maturityDate,
    notional: p.notionalKrwEok * 100_000_000,
    fixed_rate: p.fixedRate / 100,
    pay_fixed: p.payFixed,
  }));
}

/** undefined until a snapshot has loaded and there's at least one manual
 * position -- the backend rejects an empty positions list (PortfolioPriceRequest.positions
 * is Field(min_length=1), irs_pricer/api/models.py:215). */
export function buildManualPortfolioPriceRequest(
  positions: ManualPosition[],
  snapshot: MarketDataResponse | undefined,
): PortfolioPriceRequest | undefined {
  if (!snapshot || positions.length === 0) return undefined;
  return {
    valuation_date: snapshot.valuation_date,
    cd_rate: snapshot.cd_rate,
    on_rate: snapshot.on_rate,
    swap_quotes: snapshot.swap_quotes,
    positions: manualPositionsToPositionsIn(positions),
    data_source: "true_data",
  };
}
