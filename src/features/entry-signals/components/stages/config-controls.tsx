"use client";

/**
 * Configure-stage control primitives (s17) — the exact control grammar the
 * Simulation config pass established in s11 (segmented button groups for
 * mutually exclusive choices, −/+ steppers with a typed field for numerics;
 * no sliders, no slide toggles). Local copies rather than imports: the
 * simulation slice is import-isolated (and owned by a parallel session), so
 * the recipe is reproduced here on the same Button/Input primitives with no
 * new visual language.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Segmented button group (mutually exclusive choice). A value outside
 * `choices` renders with no segment pressed — never coerced (the custom
 * lookback field can hold e.g. 45D while no preset is active). */
export function SegmentedButtons({
  choices,
  value,
  onChange,
  format,
  label,
}: {
  choices: readonly number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full border border-border-subtle">
      {choices.map((c) => (
        <Button
          key={c}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          data-num
          className={cn(
            "min-w-0 flex-1 px-0 text-micro",
            value === c
              ? "bg-sem-info-ghost text-sem-info shadow-[inset_0_0_0_1px_var(--sem-info)]"
              : "text-fg-muted",
          )}
        >
          {format(c)}
        </Button>
      ))}
    </div>
  );
}

/** −/+ stepper + typed numeric field. Local draft so partial input ("-",
 * "1.") can be typed; every keystroke commits the clamped parse; blur snaps
 * the draft back to the committed value. Commits round to 3 decimals so
 * fractional σ steps never leak float noise into the store. */
export function StepperField({
  label,
  value,
  min,
  max = Number.MAX_SAFE_INTEGER,
  step,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  onCommit: (n: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) =>
    Math.round(Math.max(min, Math.min(max, Number.isFinite(n) ? n : min)) * 1000) / 1000;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-label uppercase text-fg-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1">
        <Button
          type="button"
          variant="icon"
          size="sm"
          aria-label={`${label} ${step} 감소`}
          onClick={() => onCommit(clamp(value - step))}
        >
          −
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            type="text"
            inputMode="decimal"
            data-num
            aria-label={label}
            className="text-right"
            value={draft ?? String(value)}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n)) onCommit(clamp(n));
            }}
            onBlur={() => setDraft(null)}
          />
        </div>
        <Button
          type="button"
          variant="icon"
          size="sm"
          aria-label={`${label} ${step} 증가`}
          onClick={() => onCommit(clamp(value + step))}
        >
          +
        </Button>
      </div>
    </div>
  );
}
