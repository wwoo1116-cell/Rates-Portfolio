// Tooltip compatibility shim — replaces Radix UI Tooltip with lightweight wrappers.
// New code should use Blueprint's Tooltip directly from @blueprintjs/core.
import type { ReactNode } from "react";

interface TooltipProps {
  children: ReactNode;
  delayDuration?: number;
}
interface TooltipContentProps {
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}
interface TooltipTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export function TooltipProvider({ children }: TooltipProps) {
  return <>{children}</>;
}
export function Tooltip({ children }: TooltipProps) {
  return <>{children}</>;
}
export function TooltipTrigger({ children }: TooltipTriggerProps) {
  return <>{children}</>;
}
export function TooltipContent({ children }: TooltipContentProps) {
  // Compat shim: does not render. Use Blueprint Tooltip in new code.
  return null;
}
