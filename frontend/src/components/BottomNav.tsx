"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, MessageSquareText, GraduationCap, Settings, Siren } from "lucide-react";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { href: "/translate", label: "Translate", icon: Camera },
  { href: "/conversation", label: "Talk", icon: MessageSquareText },
  { href: "/emergency", label: "Emergency", icon: Siren, urgent: true },
  { href: "/learn", label: "Learn", icon: GraduationCap },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-signal-100 bg-white/95 backdrop-blur dark:bg-surface-dark/95 dark:border-ink-700"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-between px-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon, urgent }) => {
          const active = pathname?.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={clsx(
                  "flex flex-col items-center gap-1 px-2 py-3 text-xs font-semibold transition-colors",
                  urgent
                    ? "text-urgent"
                    : active
                    ? "text-signal"
                    : "text-ink-500 hover:text-signal dark:text-signal-100"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={26} strokeWidth={active || urgent ? 2.4 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
