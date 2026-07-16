import { cn } from "@/lib/utils";

export type StatusDotVariant = "live" | "stale" | "offline" | "neutral";

// S12: connection status is not a signed value, so it can't keep green (and
// Jade is locked to signed semantics). live = near-white + the existing ping
// animation carries "healthy"; stale keeps accent; offline is a danger state.
// Judgment call — flagged in REPORT_s12.md for the owner's calibration pass.
const VARIANT_CLASSES: Record<StatusDotVariant, string> = {
  live: "bg-fg-primary",
  stale: "bg-sem-risk",
  offline: "bg-sem-danger",
  neutral: "bg-fg-dim",
};

export interface StatusDotProps {
  variant: StatusDotVariant;
  className?: string;
}

export function StatusDot({ variant, className }: StatusDotProps) {
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {variant === "live" && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            VARIANT_CLASSES[variant],
          )}
        />
      )}
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", VARIANT_CLASSES[variant])}
      />
    </span>
  );
}
