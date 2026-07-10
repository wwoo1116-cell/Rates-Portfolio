"use client";

import { Card } from "@blueprintjs/core";
import { ScenarioSelection } from "./scenario-selection";
import { ResultsPanel } from "./results-panel";
import { PnlImpactChart } from "./pnl-impact-chart";

// Macro-shock stress testing on the current real portfolio (usePortfolioRiskBuckets,
// via ScenarioSelection). The KTB 10Y historical-snapshot chart (historical-snapshot.tsx)
// is a separate, unrelated market-data visualization, not a stress test on this book,
// so it stays out of this tab's default view.
export function BacktestWorkspace() {
  return (
    <div style={{ display: "flex", height: "100%", width: "100%", padding: "16px", gap: "16px", background: "var(--bg-primary)" }}>
      {/* Left Column: Scenario picker */}
      <div style={{ width: "320px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
          <ScenarioSelection />
        </Card>
      </div>

      {/* Right Column: Results + asset-class impact */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", minWidth: 0, minHeight: 0 }}>
        <Card style={{ flex: 1.5, padding: 0, overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
          <ResultsPanel />
        </Card>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
          <PnlImpactChart />
        </Card>
      </div>
    </div>
  );
}
