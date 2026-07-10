/**
 * Shared request-building helpers for the two live IRS-position views
 * (Portfolio Management's grid, Phase 3; Home's status view/risk heatmap,
 * Phase 4/5). All three of price/delta/historical-pnl start from the same
 * "current trades + latest market snapshot" shape, so the mapping lives here
 * once rather than being re-derived per view.
 */
import type { MarketDataResponse, PortfolioPositionIn, PortfolioPriceRequest, TradeOut } from "./api-client";

export function tradesToPositionsIn(trades: TradeOut[]): PortfolioPositionIn[] {
  return trades.map((t) => ({
    position_id: t.external_position_id,
    start_date: t.start_date,
    maturity_date: t.maturity_date,
    notional: t.notional,
    fixed_rate: t.fixed_rate,
    pay_fixed: t.pay_fixed,
    float_spread: t.float_spread,
  }));
}

/** Shared body shape for POST /api/portfolio/price and /delta -- both take
 * an identical PortfolioPriceRequest. undefined until a snapshot has loaded
 * and there's at least one trade (the backend rejects an empty positions list). */
export function buildPortfolioPriceRequest(
  trades: TradeOut[],
  snapshot: MarketDataResponse | undefined,
): PortfolioPriceRequest | undefined {
  if (!snapshot || trades.length === 0) return undefined;
  return {
    valuation_date: snapshot.valuation_date,
    cd_rate: snapshot.cd_rate,
    on_rate: snapshot.on_rate,
    swap_quotes: snapshot.swap_quotes,
    positions: tradesToPositionsIn(trades),
    data_source: "true_data",
  };
}
