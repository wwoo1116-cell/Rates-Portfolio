"use client";

import { Card } from "@blueprintjs/core";
import { PricerPage } from "./pricer-page";
import { ImpactGrid } from "./impact-grid";
import { TradeEntry } from "./trade-entry";

export function SimulationWorkspace() {
  return (
    <div style={{ display: "flex", height: "100%", width: "100%", padding: "16px", gap: "16px", background: "var(--bg-primary)" }}>
      {/* Left Column: Sandbox trade entry */}
      <div style={{ width: "320px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
          <TradeEntry />
        </Card>
      </div>

      {/* Right Column: Charts */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", minWidth: 0, minHeight: 0 }}>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
          <PricerPage />
        </Card>

        <Card style={{ height: "280px", padding: 0, overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
          <ImpactGrid />
        </Card>
      </div>
    </div>
  );
}
