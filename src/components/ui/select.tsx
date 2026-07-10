// Select shim — Radix Select removed. Replace with Blueprint HTMLSelect in new code.
// This file re-exports no-op shims so existing import sites compile.
import type { ReactNode, SelectHTMLAttributes } from "react";

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}
interface SelectTriggerProps extends SelectHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  className?: string;
}
interface SelectContentProps { children?: ReactNode }
interface SelectItemProps {
  value: string;
  children?: ReactNode;
  className?: string;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  return <>{children}</>;
}
export function SelectTrigger({ children, ...rest }: SelectTriggerProps) {
  return <button type="button" {...rest}>{children}</button>;
}
export function SelectValue({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function SelectContent({ children }: SelectContentProps) {
  return null; // Blueprint HTMLSelect handles its own dropdown
}
export function SelectItem({ value, children, className }: SelectItemProps) {
  return null;
}
export function SelectSeparator() {
  return null;
}
