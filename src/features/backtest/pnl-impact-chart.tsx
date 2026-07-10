"use client";

import { useBacktestStore } from "@/stores/backtest-store";
import { NonIdealState } from "@blueprintjs/core";

export function PnlImpactChart() {
  const result = useBacktestStore((s) => s.result);

  if (!result) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <NonIdealState
          icon="timeline-bar-chart"
          title="No Impact Data"
          description="P&L impact by asset class appears here after a backtest run"
        />
      </div>
    );
  }

  const maxAbsImpact = Math.max(...result.assetClassImpact.map((d) => Math.abs(d.impact)), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "16px 16px 8px" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
        {result.assetClassImpact.map((d) => {
          const impact = d.impact;
          const pos = impact > 0;
          const barWidth = `${(Math.abs(impact) / maxAbsImpact) * 50}%`;
          
          return (
            <div key={d.assetClass} style={{ display: "flex", alignItems: "center", height: 20 }}>
              <div style={{ width: 48, fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                {d.assetClass}
              </div>
              <div style={{ flex: 1, display: "flex", position: "relative", alignItems: "center" }}>
                {/* Center zero line */}
                <div style={{ position: "absolute", left: "50%", top: -4, bottom: -4, width: 1, background: "var(--border-strong)", zIndex: 0 }} />
                
                {/* Negative Bar */}
                <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", paddingRight: 2, zIndex: 1 }}>
                  {!pos && impact !== 0 && (
                    <div style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 11, color: "var(--fg-secondary)", marginRight: 6 }}>
                        {impact.toFixed(1)}
                      </span>
                      <div style={{ height: 16, width: barWidth, background: "var(--sem-negative)", borderRadius: 2 }} />
                    </div>
                  )}
                </div>
                
                {/* Positive Bar */}
                <div style={{ flex: 1, display: "flex", justifyContent: "flex-start", paddingLeft: 2, zIndex: 1 }}>
                  {pos && impact !== 0 && (
                    <div style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "flex-start" }}>
                      <div style={{ height: 16, width: barWidth, background: "var(--sem-positive)", borderRadius: 2 }} />
                      <span style={{ fontSize: 11, color: "var(--fg-secondary)", marginLeft: 6 }}>
                        +{impact.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
