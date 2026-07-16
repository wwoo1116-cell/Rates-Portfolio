"use client";

import { Callout, Card } from "@blueprintjs/core";

export function ResultsDashboard() {
  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column", padding: 16, gap: 16, overflow: "auto" }}>
      {/* S12: intent="success" rendered Blueprint's own vendor-green tint
          (compiled CSS, outside the token layer). Success = confirmation,
          not a signed value → primary/accent. */}
      <Callout intent="primary" title="Optimization Complete">
        The solver converged in 4.2 seconds. Found optimal allocation satisfying 12/12 constraints. Expected yield improvement: +14 bps.
      </Callout>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[
          { title: "Target Yield", value: "3.85%", sub: "+0.14% vs Current" },
          { title: "Portfolio Duration", value: "4.2 Yrs", sub: "Within 4.0 - 5.0 limits" },
          { title: "Credit Quality (Avg)", value: "AA-", sub: "Maintained" },
          { title: "Turnover constraint", value: "12.4%", sub: "Below 15% Max" },
        ].map((item, i) => (
          <Card key={i} style={{ padding: "16px", background: "var(--bg-surface)", border: "1px solid var(--border-dim)" }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              {item.title}
            </div>
            <div style={{ fontSize: 24, fontWeight: 600, color: "var(--fg-primary)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
              {item.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--sem-info)" }}>
              {item.sub}
            </div>
          </Card>
        ))}
      </div>
      
      <Card style={{ flex: 1, minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-surface)", border: "1px dashed var(--border-dim)" }}>
        <span style={{ color: "var(--fg-dim)", fontSize: 12 }}>Detailed Allocation Table (Pending)</span>
      </Card>
    </div>
  );
}
