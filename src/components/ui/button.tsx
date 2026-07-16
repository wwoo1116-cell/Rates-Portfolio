"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "icon" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const VARIANT_STYLES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-[var(--accent)] text-white hover:bg-[var(--accent-dim)] disabled:opacity-40",
  secondary:
    "bg-transparent border border-[var(--border-subtle)] text-[var(--fg-primary)] hover:bg-[var(--bg-overlay)] disabled:opacity-40",
  ghost:
    "bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--fg-primary)] disabled:opacity-40",
  icon:
    "bg-transparent text-[var(--fg-muted)] hover:bg-[var(--bg-overlay)] hover:text-[var(--fg-secondary)] disabled:opacity-40",
  danger:
    "bg-transparent border border-[var(--border-subtle)] text-[var(--sem-danger)] hover:bg-[var(--sem-danger-soft)] disabled:opacity-40",
};

const SIZE_STYLES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-7 px-2 text-xs gap-1",
  md: "h-8 px-3 text-sm gap-1.5",
  lg: "h-9 px-4 text-sm gap-2",
};

const ICON_SIZE_STYLES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "w-7 px-0",
  md: "w-8 px-0",
  lg: "w-9 px-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const isIcon = variant === "icon";
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          // Base: no rounded corners, no shadow, instant color transitions
          "inline-flex items-center justify-center font-medium cursor-pointer",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]",
          "disabled:pointer-events-none transition-colors duration-75",
          VARIANT_STYLES[variant],
          SIZE_STYLES[size],
          isIcon && ICON_SIZE_STYLES[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <span
            className="inline-block w-3 h-3 border border-current border-t-transparent animate-spin"
            aria-hidden
          />
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";
