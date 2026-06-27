"use client";

import { clsx } from "clsx";
import type { OutputPreference } from "@/types";

const OPTIONS: { value: OutputPreference; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "speech", label: "Speech" },
  { value: "both", label: "Both" },
];

export function OutputModeToggle({
  value,
  onChange,
}: {
  value: OutputPreference;
  onChange: (v: OutputPreference) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Output preference" className="inline-flex rounded-xl bg-signal-50 p-1 dark:bg-ink-700">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            value === opt.value
              ? "bg-signal text-white"
              : "text-ink-500 dark:text-signal-100"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
