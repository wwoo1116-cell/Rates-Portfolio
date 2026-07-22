// Shared /api/portfolio/* request shape -- used by both the NPV submit
// (PortfolioPage's handleSubmit) and the Risk Analytics delta fetch
// (RiskAnalyticsPanel) so the two can never drift onto two different
// snapshots/position payloads the way the price/delta inputs otherwise could.
export function buildPortfolioRequest(positions, valuationDate, effectiveMarket, apiDataSource) {
  return {
    valuation_date: valuationDate,
    cd_rate: effectiveMarket.cdRate,
    on_rate: effectiveMarket.onRate ?? null,
    swap_quotes: effectiveMarket.quotes,
    positions: positions.map((p) => ({
      position_id: p.id,
      start_date: p.startDate,
      maturity_date: p.maturityDate,
      notional: Number(p.notional),
      fixed_rate: Number(p.fixedRatePct) / 100,
      pay_fixed: p.direction === 'pay',
    })),
    data_source: apiDataSource,
  }
}
