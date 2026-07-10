import { cn } from "@/lib/utils";

export type StatusDotVariant = "live" | "stale" | "offline" | "neutral";

const VARIANT_CLASSES: Record<StatusDotVariant, string> = {
  live: "bg-sem-positive",
  stale: "bg-sem-risk",
  offline: "bg-sem-negative",
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
