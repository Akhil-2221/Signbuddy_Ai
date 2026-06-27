"use client";

import Link from "next/link";
import { Camera, MessageSquareText, Siren, GraduationCap, History } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { useAppStore } from "@/lib/store";

const TILES = [
  {
    href: "/translate",
    title: "Translate",
    desc: "Sign to text & speech, live",
    icon: Camera,
    bg: "bg-signal",
  },
  {
    href: "/conversation",
    title: "Two-Way Talk",
    desc: "Have a real conversation",
    icon: MessageSquareText,
    bg: "bg-signal-600",
  },
  {
    href: "/emergency",
    title: "Emergency",
    desc: "Urgent phrases, one tap",
    icon: Siren,
    bg: "bg-urgent",
  },
  {
    href: "/learn",
    title: "Learn Signs",
    desc: "Practice with your AI tutor",
    icon: GraduationCap,
    bg: "bg-ink-700",
  },
];

export default function HomePage() {
  const user = useAppStore((s) => s.user);

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <header className="px-6 pt-10 pb-4">
        <p className="text-lg text-ink-500 dark:text-signal-100">Hello{user?.fullName ? `, ${user.fullName.split("-")[0]}` : ""} 👋</p>
        <h1 className="font-display text-2xl font-extrabold text-ink-900 dark:text-white">
          What would you like to do?
        </h1>
      </header>

      <section className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-2">
        {TILES.map(({ href, title, desc, icon: Icon, bg }) => (
          <Link
            key={href}
            href={href}
            className={`hc-border flex items-center gap-4 rounded-2xl ${bg} px-6 py-7 text-white shadow-sm transition-transform active:scale-[0.98]`}
          >
            <Icon size={34} strokeWidth={2} />
            <span>
              <span className="block font-display text-xl font-bold">{title}</span>
              <span className="block text-sm opacity-90">{desc}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="mt-8 px-6">
        <Link
          href="/history"
          className="flex items-center gap-3 rounded-2xl border border-signal-100 bg-white px-5 py-4 text-ink-700 dark:bg-surface-dark dark:border-ink-700 dark:text-signal-100"
        >
          <History size={22} />
          <span className="font-medium">View past conversations</span>
        </Link>
      </section>

      <BottomNav />
    </main>
  );
}
