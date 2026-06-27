"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

/**
 * Applies the user's accessibility preferences (or sensible guest defaults)
 * to the <html> element as data attributes, which globals.css reads to drive
 * text size, contrast, dark mode, and motion.
 */
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const user = useAppStore((s) => s.user);

  useEffect(() => {
    const html = document.documentElement;
    const settings = user?.accessibilitySettings ?? {
      highContrast: false,
      darkMode: false,
      textSize: "medium" as const,
      reduceMotion: false,
      voiceSpeed: 1.0,
    };

    html.setAttribute("data-text-size", settings.textSize);
    html.setAttribute("data-high-contrast", String(settings.highContrast));
    html.setAttribute("data-reduce-motion", String(settings.reduceMotion));
    html.classList.toggle("dark", settings.darkMode);
  }, [user?.accessibilitySettings]);

  return <>{children}</>;
}
