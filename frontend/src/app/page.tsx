"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hand, ArrowRight } from "lucide-react";
import { BigButton } from "@/components/BigButton";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SignLanguage, User } from "@/types";

const SIGN_LANGUAGES: { code: SignLanguage; label: string; region: string }[] = [
  { code: "ASL", label: "American Sign Language", region: "USA / Canada" },
  { code: "ISL", label: "Indian Sign Language", region: "India" },
  { code: "BSL", label: "British Sign Language", region: "UK" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const setSession = useAppStore((s) => s.setSession);
  const [selected, setSelected] = useState<SignLanguage>("ASL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ user: User; accessToken: string }>("/api/v1/auth/guest", {
        signLanguage: selected,
      });
      setSession(res.user, res.accessToken);
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-12 dark:bg-canvas-dark">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-signal text-white">
          <Hand size={40} strokeWidth={2.2} />
        </div>
        <h1 className="font-display text-3xl font-extrabold text-ink-900 dark:text-white">
          SignBuddy AI
        </h1>
        <p className="mt-3 text-lg text-ink-500 dark:text-signal-100">
          Sign in front of your camera. We&apos;ll turn it into text and speech, instantly.
        </p>

        <fieldset className="mt-10 text-left">
          <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-signal-100">
            Which sign language do you use?
          </legend>
          <div className="space-y-3">
            {SIGN_LANGUAGES.map((lang) => (
              <label
                key={lang.code}
                className={`hc-border flex cursor-pointer items-center justify-between rounded-2xl border-2 px-5 py-4 transition-colors ${
                  selected === lang.code
                    ? "border-signal bg-signal-50 dark:bg-ink-700"
                    : "border-signal-100 bg-white dark:bg-surface-dark dark:border-ink-700"
                }`}
              >
                <span>
                  <span className="block font-display font-semibold text-ink-900 dark:text-white">
                    {lang.label}
                  </span>
                  <span className="block text-sm text-ink-500 dark:text-signal-100">{lang.region}</span>
                </span>
                <input
                  type="radio"
                  name="signLanguage"
                  value={lang.code}
                  checked={selected === lang.code}
                  onChange={() => setSelected(lang.code)}
                  className="h-5 w-5 accent-signal"
                />
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-urgent">
            {error}
          </p>
        )}

        <BigButton
          size="large"
          className="mt-8 w-full"
          icon={<ArrowRight size={22} />}
          onClick={handleContinue}
          disabled={loading}
        >
          {loading ? "Starting…" : "Get Started"}
        </BigButton>

        <p className="mt-4 text-sm text-ink-500 dark:text-signal-100">
          No account needed. You can create one later in Settings.
        </p>
      </div>
    </main>
  );
}
