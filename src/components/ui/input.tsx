import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  suffix?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, suffix, error, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="flex flex-col gap-2">
        {label && (
          <label htmlFor={inputId} className="text-label text-fg-muted">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "h-8 w-full rounded border border-transparent bg-bg-tertiary px-3 text-body text-fg-primary outline-none placeholder:text-fg-dim focus:border-sem-info",
              suffix && "pr-12",
              error && "border-sem-danger",
              className,
            )}
            {...props}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3 text-micro text-fg-muted">
              {suffix}
            </span>
          )}
        </div>
        {error && <span className="text-micro text-sem-danger">{error}</span>}
      </div>
    );
  },
);
Input.displayName = "Input";
