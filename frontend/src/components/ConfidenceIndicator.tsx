import { clsx } from "clsx";

interface ConfidenceIndicatorProps {
  confidence: number; // 0-1
  className?: string;
}

/**
 * Visual confidence feedback — a calm traffic-light bar, not a scary number.
 * Low confidence triggers the fallback UI elsewhere (manual correction prompt),
 * but this component just shows the signal clearly without alarming the user.
 */
export function ConfidenceIndicator({ confidence, className }: ConfidenceIndicatorProps) {
  const pct = Math.round(confidence * 100);
  const level = confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";

  return (
    <div className={clsx("flex items-center gap-2", className)} aria-label={`Confidence ${pct}%`}>
      <div className="h-2 flex-1 rounded-full bg-signal-50 overflow-hidden dark:bg-ink-700">
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-500",
            level === "high" && "bg-signal",
            level === "medium" && "bg-amber-500",
            level === "low" && "bg-urgent"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium text-ink-500 dark:text-signal-100 tabular-nums w-10 text-right">
        {pct}%
      </span>
    </div>
  );
}
