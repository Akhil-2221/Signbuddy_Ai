"use client";

import { useState } from "react";
import { Moon, Sun, Type, Eye, Zap, Volume2 } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { BottomNav } from "@/components/BottomNav";
import { BigButton } from "@/components/BigButton";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { SPOKEN_LANGUAGES } from "@/types";
import type { SignLanguage, TextSize } from "@/types";

const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: "small", label: "A" },
  { value: "medium", label: "A" },
  { value: "large", label: "A" },
  { value: "extra_large", label: "A" },
];

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-signal-100 bg-white px-5 py-4 dark:bg-surface-dark dark:border-ink-700">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-50 text-signal dark:bg-ink-700 dark:text-signal-100">
          {icon}
        </div>
        <div>
          <p className="font-semibold text-ink-900 dark:text-white">{label}</p>
          <p className="text-sm text-ink-500 dark:text-signal-100">{description}</p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${checked ? "bg-signal" : "bg-ink-500/30"}`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-transform ${checked ? "translate-x-7" : "translate-x-1"}`}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const user = useAppStore((s) => s.user);
  const updateAccessibility = useAppStore((s) => s.updateAccessibility);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const [saving, setSaving] = useState(false);

  if (!user) return null;
  const a = user.accessibilitySettings;

  async function persist(payload: Parameters<typeof api.patch>[1]) {
    setSaving(true);
    try {
      await api.patch("/api/v1/users/settings", payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <ScreenHeader title="Settings" subtitle={saving ? "Saving…" : "Changes save automatically"} />

      <section className="space-y-6 px-4">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-signal-100">
            Accessibility
          </h2>
          <div className="space-y-3">
            <ToggleRow
              icon={<Moon size={20} />}
              label="Dark mode"
              description="Easier on the eyes in low light"
              checked={a.darkMode}
              onChange={(v) => {
                updateAccessibility({ darkMode: v });
                persist({ accessibilitySettings: { darkMode: v } });
              }}
            />
            <ToggleRow
              icon={<Eye size={20} />}
              label="High contrast"
              description="Stronger borders and colors"
              checked={a.highContrast}
              onChange={(v) => {
                updateAccessibility({ highContrast: v });
                persist({ accessibilitySettings: { highContrast: v } });
              }}
            />
            <ToggleRow
              icon={<Zap size={20} />}
              label="Reduce motion"
              description="Turn off animations and transitions"
              checked={a.reduceMotion}
              onChange={(v) => {
                updateAccessibility({ reduceMotion: v });
                persist({ accessibilitySettings: { reduceMotion: v } });
              }}
            />

            <div className="rounded-2xl border border-signal-100 bg-white px-5 py-4 dark:bg-surface-dark dark:border-ink-700">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-50 text-signal dark:bg-ink-700 dark:text-signal-100">
                  <Type size={20} />
                </div>
                <p className="font-semibold text-ink-900 dark:text-white">Text size</p>
              </div>
              <div className="flex gap-2">
                {TEXT_SIZES.map((size, idx) => (
                  <button
                    key={size.value}
                    onClick={() => {
                      updateAccessibility({ textSize: size.value });
                      persist({ accessibilitySettings: { textSize: size.value } });
                    }}
                    className={`flex-1 rounded-xl border-2 py-3 font-display font-bold ${
                      a.textSize === size.value
                        ? "border-signal bg-signal-50 text-signal dark:bg-ink-700"
                        : "border-signal-100 text-ink-500 dark:border-ink-700 dark:text-signal-100"
                    }`}
                    style={{ fontSize: `${1 + idx * 0.25}rem` }}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-signal-100 bg-white px-5 py-4 dark:bg-surface-dark dark:border-ink-700">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-50 text-signal dark:bg-ink-700 dark:text-signal-100">
                  <Volume2 size={20} />
                </div>
                <p className="font-semibold text-ink-900 dark:text-white">Voice speed</p>
                <span className="ml-auto font-mono text-sm text-ink-500 dark:text-signal-100">{a.voiceSpeed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={a.voiceSpeed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  updateAccessibility({ voiceSpeed: v });
                }}
                onMouseUp={(e) => persist({ accessibilitySettings: { voiceSpeed: Number((e.target as HTMLInputElement).value) } })}
                onTouchEnd={(e) => persist({ accessibilitySettings: { voiceSpeed: Number((e.target as HTMLInputElement).value) } })}
                className="w-full accent-signal"
              />
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-signal-100">
            Sign language
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {(["ASL", "ISL", "BSL"] as SignLanguage[]).map((lang) => (
              <button
                key={lang}
                onClick={() => {
                  updatePreferences({ signLanguage: lang });
                  persist({ preferredSignLanguage: lang });
                }}
                className={`rounded-xl border-2 py-3 font-display font-bold ${
                  user.preferredSignLanguage === lang
                    ? "border-signal bg-signal-50 text-signal dark:bg-ink-700"
                    : "border-signal-100 text-ink-500 dark:border-ink-700 dark:text-signal-100"
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-signal-100">
            Output language
          </h2>
          <select
            value={user.preferredSpokenLanguage}
            onChange={(e) => {
              updatePreferences({ spokenLanguage: e.target.value });
              persist({ preferredSpokenLanguage: e.target.value });
            }}
            className="w-full rounded-xl border-2 border-signal-100 bg-white px-4 py-3 text-lg dark:bg-surface-dark dark:border-ink-700 dark:text-white"
          >
            {SPOKEN_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} — {l.nativeLabel}
              </option>
            ))}
          </select>
        </div>

        {user.isAnonymous && (
          <div className="rounded-2xl border-2 border-dashed border-signal-100 px-5 py-5 text-center dark:border-ink-700">
            <p className="font-semibold text-ink-900 dark:text-white">You&apos;re using a guest session</p>
            <p className="mt-1 text-sm text-ink-500 dark:text-signal-100">
              Create an account to save your history and progress across devices.
            </p>
            <BigButton className="mt-4" onClick={() => (window.location.href = "/register")}>
              Create account
            </BigButton>
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
