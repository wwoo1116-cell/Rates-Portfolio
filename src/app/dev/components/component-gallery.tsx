"use client";

import { type ReactNode, useState } from "react";
import { Moon, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HTMLSelect, SegmentedControl, Tooltip } from "@blueprintjs/core";
import { Chip } from "@/components/ui/chip";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { toast } from "@/stores/toast-store";
import { PriceDisplay } from "@/components/data/price-display";
import { DeltaIndicator } from "@/components/data/delta-indicator";
import { Sparkline } from "@/components/data/sparkline";
import { HeatmapPill } from "@/components/data/heatmap-pill";
import { StatusDot, type StatusDotVariant } from "@/components/data/status-dot";
import { WorkspacePanel } from "@/components/data/workspace-panel";
import { useThemeStore } from "@/stores/theme-store";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border-subtle pt-6">
      <h2 className="text-h2 text-fg-primary">{title}</h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

const TONES: BadgeTone[] = ["pnl-positive", "pnl-negative", "danger", "risk", "info"];
const STATUS_VARIANTS: StatusDotVariant[] = ["live", "stale", "offline", "neutral"];

export function ComponentGallery() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const [segmentVal, setSegmentVal] = useState("pay");
  const [selectValue, setSelectValue] = useState("irs");

  return (
    <div className="min-h-full bg-bg-primary px-8 py-8 text-fg-primary">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Component Gallery</h1>
          <p className="text-body text-fg-muted">
            Dev-only visual review surface — every primitive and data component, every state.
          </p>
        </div>
        <Button variant="secondary" size="md" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        <Section title="Button">
          <Button variant="primary" size="sm">Primary sm</Button>
          <Button variant="primary" size="md">Primary md</Button>
          <Button variant="primary" size="lg">Primary lg</Button>
          <Button variant="secondary" size="md">Secondary</Button>
          <Button variant="ghost" size="md">Ghost</Button>
          <Button variant="icon" size="md" aria-label="Settings">
            <Settings size={16} strokeWidth={1.5} />
          </Button>
          <Button variant="primary" size="md" disabled>Disabled</Button>
        </Section>

        <Section title="Input">
          <Input placeholder="Default input" className="w-48" />
          <Input label="Notional" placeholder="0" className="w-48" />
          <Input label="Notional" suffix="100M KRW" placeholder="500" className="w-48" />
          <Input label="Rate" error="Rate must be within 0–10%" defaultValue="12.5" className="w-48" />
        </Section>

        <Section title="Select">
          <HTMLSelect
            value={selectValue}
            onChange={(e) => setSelectValue(e.target.value)}
            options={[
              { label: "IRS", value: "irs" },
              { label: "KTB", value: "ktb" },
              { label: "CRS", value: "crs" },
              { label: "KTBF", value: "ktbf" },
            ]}
          />
        </Section>

        <Section title="SegmentedControl">
          <SegmentedControl
            options={[
              { label: "Pay", value: "pay" },
              { label: "Receive", value: "receive" },
            ]}
            value={segmentVal}
            onValueChange={setSegmentVal}
          />
        </Section>

        <Section title="Chip">
          <Chip label="BOOK" value="CMA RP" onRemove={() => {}} />
          <Chip label="ASSET" value="IRS" onRemove={() => {}} />
          <Chip label="TENOR" value={["3Y", "5Y", "10Y"]} onRemove={() => {}} />
          <Chip label="BOOK" value="RP Trading" />
        </Section>

        <Section title="Badge">
          {TONES.map((tone) => (
            <Badge key={`soft-${tone}`} tone={tone} variant="soft">
              {tone}
            </Badge>
          ))}
          {TONES.map((tone) => (
            <Badge key={`solid-${tone}`} tone={tone} variant="solid">
              {tone}
            </Badge>
          ))}
        </Section>

        <Section title="Tooltip">
          <Tooltip content="Model not yet connected">
            <Button variant="secondary" size="md">Hover me</Button>
          </Tooltip>
        </Section>

        <Section title="Toast">
          <Button
            variant="secondary"
            size="md"
            onClick={() => toast({ title: "Optimization queued", variant: "default" })}
          >
            Default
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() =>
              toast({ title: "Backtest complete", description: "Results updated below.", variant: "success" })
            }
          >
            Success
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => toast({ title: "Model not yet connected", variant: "error" })}
          >
            Error
          </Button>
        </Section>

        <Section title="PriceDisplay">
          <PriceDisplay value={3.4567} unit="%" />
          <PriceDisplay value={-1.2345} unit="%" />
          <PriceDisplay value={111.205} unit="" />
          <PriceDisplay value={3.4567} unit="%" size="display" />
        </Section>

        <Section title="DeltaIndicator">
          <DeltaIndicator value={2.5} />
          <DeltaIndicator value={-1.8} />
          <DeltaIndicator value={0} />
        </Section>

        <Section title="Sparkline">
          <Sparkline data={[10, 12, 11, 14, 18, 16, 20]} variant="auto" />
          <Sparkline data={[20, 18, 19, 15, 13, 11, 9]} variant="auto" />
          <Sparkline data={[5, 5, 6, 5, 4, 5, 5]} variant="neutral" />
        </Section>

        <Section title="HeatmapPill">
          <HeatmapPill value={0.2} min={-1} max={1} direction="bidirectional" />
          <HeatmapPill value={-0.6} min={-1} max={1} direction="bidirectional" />
          <HeatmapPill value={0.95} min={-1} max={1} direction="bidirectional" />
          <HeatmapPill value={0.4} min={0} max={1} direction="unidirectional" />
        </Section>

        <Section title="StatusDot">
          {STATUS_VARIANTS.map((variant) => (
            <div key={variant} className="flex items-center gap-2">
              <StatusDot variant={variant} />
              <span className="text-label text-fg-secondary">{variant}</span>
            </div>
          ))}
        </Section>

        <Section title="WorkspacePanel">
          <div className="h-48 w-80 overflow-hidden rounded-md">
            <WorkspacePanel
              title="Market Snapshot"
              onSettings={() => {}}
              onMaximize={() => {}}
              onClose={() => {}}
            >
              <div className="flex h-full items-center justify-center text-body text-fg-muted">
                Panel content
              </div>
            </WorkspacePanel>
          </div>
        </Section>
      </div>
    </div>
  );
}
