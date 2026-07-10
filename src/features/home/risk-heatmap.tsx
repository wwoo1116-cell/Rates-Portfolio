"use client";

/**
 * Home's Tenor x DV01 risk heatmap (MIGRATION_PLAN.md Phase 4). IRS is the
 * only row with a real pricing/risk engine (engine/risk.py); KTB/KTBF have
 * none yet (§3 gap table) so their cells stay visibly empty.
 *
 * "Provisional" label per §0.2: engine/risk.py's dv01()/curve_bump_scenarios()
 * documents its own Definition-of-Done failure (1Y/2Y buckets wrong-signed,
 * 1D/CD91D magnitudes 85-97% off a reference ladder -- see PROGRESS.md).
 * Shipping it labeled rather than blocking the feature entirely was the
 * resolved decision in §0.2; fixing the methodology itself is explicitly out
 * of scope here.
 *
 * NOTE on styling: DESIGN.md reserves the heat-pos/heat-neg color *gradient*
 * exclusively for the Key Rate Duration pills inside the Portfolio Management
 * grid ("the one place a color gradient is legitimate"). This heatmap uses
 * signed colored numbers instead (the Points-Not-Fills rule), not a second
 * gradient surface.
 */
import { Badge } from "@/components/ui/badge";
import { usePortfolioRiskBuckets } from "@/hooks/use-portfolio-risk";
import { TENOR_BUCKETS } from "@/lib/constants";

const UNPRICED_ROWS = ["KTB", "KTBF"] as const;

function DeltaCell({ value }: { value: number }) {
  const color = value > 0 ? "var(--sem-positive)" : value < 0 ? "var(--sem-negative)" : "var(--fg-muted)";
  const sign = value > 0 ? "+" : "";
  return (
    <span
      style={{
        display: "block",
        textAlign: "right",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        color,
      }}
    >
      {sign}
      {Math.round(value).toLocaleString()}
    </span>
  );
}

function EmptyCell() {
  return (
    <span style={{ display: "block", textAlign: "right", color: "var(--fg-dim)" }} aria-label="Not available">
      —
    </span>
  );
}

export function RiskHeatmap() {
  const { buckets: irsBuckets, hasPositions: hasIrsPositions, isLoading, isError } = usePortfolioRiskBuckets();

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">Tenor × DV01</span>
        <Badge tone="risk">Provisional</Badge>
      </div>

      {!hasIrsPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          {isError
            ? "Could not load IRS positions from the pricing server."
            : isLoading
              ? "Loading…"
              : "No IRS positions booked yet — the heatmap populates once trades exist."}
        </div>
      ) : (
        <div className="min-h-0 overflow-auto">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1.5 text-left text-label text-fg-muted font-bold uppercase">Asset</th>
                {TENOR_BUCKETS.map((bucket) => (
                  <th key={bucket} className="py-1.5 text-right text-label text-fg-muted font-bold uppercase">
                    {bucket}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-subtle">
                <td className="py-2 text-label text-fg-muted uppercase">IRS</td>
                {TENOR_BUCKETS.map((bucket) => (
                  <td key={bucket} className="py-2">
                    {irsBuckets ? <DeltaCell value={irsBuckets[bucket]} /> : <EmptyCell />}
                  </td>
                ))}
              </tr>
              {UNPRICED_ROWS.map((asset) => (
                <tr key={asset} className="border-t border-border-subtle opacity-50">
                  <td className="py-2 text-label text-fg-muted uppercase">{asset}</td>
                  {TENOR_BUCKETS.map((bucket) => (
                    <td key={bucket} className="py-2">
                      <EmptyCell />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
