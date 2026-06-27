"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function ScreenHeader({ title, subtitle, right }: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="rounded-full p-2 text-ink-700 hover:bg-signal-50 dark:text-white dark:hover:bg-ink-700"
        >
          <ChevronLeft size={26} />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900 dark:text-white">{title}</h1>
          {subtitle && <p className="text-sm text-ink-500 dark:text-signal-100">{subtitle}</p>}
        </div>
      </div>
      {right}
    </header>
  );
}
