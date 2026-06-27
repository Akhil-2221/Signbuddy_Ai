import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "urgent" | "ghost";
  size?: "default" | "large";
  children: ReactNode;
}

/**
 * The single button component used everywhere in SignBuddy.
 * Deliberately large, high-contrast, and uniform — consistency reduces
 * cognitive load far more than visual variety does, for this audience.
 */
export function BigButton({
  icon,
  variant = "primary",
  size = "default",
  className,
  children,
  ...props
}: BigButtonProps) {
  return (
    <button
      className={clsx(
        "hc-border inline-flex items-center justify-center gap-3 rounded-2xl font-display font-semibold transition-transform active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        size === "large" ? "px-8 py-5 text-xl" : "px-6 py-4 text-lg",
        variant === "primary" && "bg-signal text-white hover:bg-signal-600 border-transparent",
        variant === "secondary" &&
          "bg-white text-ink-900 border border-signal-100 hover:bg-signal-50 dark:bg-surface-dark dark:text-white dark:border-ink-500",
        variant === "urgent" && "bg-urgent text-white hover:bg-urgent-600 border-transparent",
        variant === "ghost" &&
          "bg-transparent text-ink-700 hover:bg-signal-50 border-transparent dark:text-white dark:hover:bg-ink-700",
        className
      )}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
