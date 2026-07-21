import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChipProps {
  label: string;
  value: string | string[];
  onRemove?: () => void;
  className?: string;
}

export function Chip({ label, value, onRemove, className }: ChipProps) {
  const values = Array.isArray(value) ? value : [value];
  const [first, ...rest] = values;

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center overflow-hidden rounded bg-bg-secondary label-nowrap",
        className,
      )}
      title={rest.length > 0 ? values.join(", ") : undefined}
    >
      <span className="flex h-full items-center bg-bg-tertiary px-2 text-label text-fg-muted">
        {label}
      </span>
      <span className="px-2 text-body text-fg-primary">
        {first}
        {rest.length > 0 && <span className="text-fg-muted"> +{rest.length}</span>}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} filter`}
          className="flex h-full items-center justify-center px-2 text-fg-dim hover:text-fg-secondary"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </span>
  );
}
