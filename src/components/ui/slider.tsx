import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SliderProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Range input in the system's flat control language (DESIGN.md §5): hairline
 * `bg-tertiary` track, 12px square accent thumb at the sanctioned 4px radius —
 * never `rounded-full`, which is reserved for status dots and the avatar —
 * quick color-only hover, 1px accent focus ring. A styled native
 * `<input type="range">` underneath, so `role="slider"`, keyboard arrows, and
 * form semantics come for free.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={cn(
        "h-4 w-full cursor-pointer appearance-none bg-transparent",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]",
        "disabled:pointer-events-none disabled:opacity-40",
        // WebKit: 4px track, 12px thumb centered on it ((4-12)/2 = -4px).
        "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-bg-tertiary",
        "[&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:-mt-1",
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded",
        "[&::-webkit-slider-thumb]:bg-sem-info [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-75",
        "[&:hover::-webkit-slider-thumb]:bg-[var(--accent-dim)]",
        // Firefox equivalents (thumb is auto-centered; kill its default border).
        "[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-bg-tertiary",
        "[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded",
        "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-sem-info",
        "[&:hover::-moz-range-thumb]:bg-[var(--accent-dim)]",
        className,
      )}
      {...props}
    />
  ),
);
Slider.displayName = "Slider";
