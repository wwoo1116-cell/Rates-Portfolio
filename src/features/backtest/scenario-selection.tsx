"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@blueprintjs/core";
import { usePortfolioRiskBuckets } from "@/hooks/use-portfolio-risk";
import { cn } from "@/lib/utils";
import { HISTORICAL_SCENARIOS, MPC_SCENARIOS, type Scenario } from "@/mocks/backtest";
import { useBacktestStore } from "@/stores/backtest-store";

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const selected = useBacktestStore((s) => s.selectedScenarioId === scenario.id);
  const selectScenario = useBacktestStore((s) => s.selectScenario);

  const card = (
    <button
      type="button"
      onClick={() => selectScenario(scenario.id)}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded border-l-2 px-3 py-2 text-left text-body-strong transition-colors",
        selected
          ? "border-sem-info bg-bg-secondary text-fg-primary"
          : "border-transparent text-fg-secondary hover:bg-bg-secondary",
      )}
    >
      <span>{scenario.label}</span>
      {scenario.dateRange && <span className="text-micro text-fg-muted">{scenario.dateRange}</span>}
    </button>
  );

  if (!scenario.description) return card;

  return (
    <Tooltip
      content={<div style={{ maxWidth: 256 }}>{scenario.description}</div>}
      placement="right"
      intent="primary"
    >
      {card}
    </Tooltip>
  );
}

function ScenarioGroupSection({ title, scenarios }: { title: string; scenarios: Scenario[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-1 py-1 text-label text-fg-muted"
      >
        {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        {title}
      </button>
      {open && (
        <div className="flex flex-col gap-1">
          {scenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ScenarioSelection() {
  const selectedScenarioId = useBacktestStore((s) => s.selectedScenarioId);
  const isRunning = useBacktestStore((s) => s.isRunning);
  const runBacktest = useBacktestStore((s) => s.runBacktest);
  const { buckets, totalDv01, hasPositions, isLoading } = usePortfolioRiskBuckets();

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        <ScenarioGroupSection title="MPC Shock" scenarios={MPC_SCENARIOS} />
        <ScenarioGroupSection title="Historical Replay" scenarios={HISTORICAL_SCENARIOS} />
      </div>
      {!hasPositions && !isLoading && (
        <p className="text-micro text-sem-negative">No portfolio risk detected; scenario impacts are zero.</p>
      )}
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={!selectedScenarioId || isRunning || !hasPositions || !buckets}
        onClick={() => buckets && runBacktest(buckets, totalDv01)}
        className="w-full"
      >
        {isRunning ? "Running…" : "Run Backtest"}
      </Button>
    </div>
  );
}
