"use client";

/**
 * Segmented button group (mutually exclusive choice) — the s11 T2 recipe,
 * extracted from configure-stage.tsx at SIM2-1 so the Curve View panel's
 * 커브형/시계열형 toggle reuses the exact same visual language. Composed from
 * the Button primitive — pressed state reuses the accent-ghost recipe the
 * "+ 추가" button established (border-sem-info / bg-sem-info-ghost /
 * text-sem-info). A value outside `choices` (possible if the store was
 * patched elsewhere) simply renders with no segment pressed — never coerced.
 *
 * Generic over the choice type: the horizon group uses numbers, SIM2-1's
 * preview-mode toggle uses string literals. Behavior is unchanged from the
 * pre-extraction numeric version.
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SegmentedButtons<T extends string | number>({
  choices,
  value,
  onChange,
  format,
  label,
}: {
  choices: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full border border-border-subtle">
      {choices.map((c) => (
        <Button
          key={String(c)}
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
