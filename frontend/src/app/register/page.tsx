"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, User as UserIcon } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { BigButton } from "@/components/BigButton";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { User } from "@/types";

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAppStore((s) => s.setSession);
  const currentUser = useAppStore((s) => s.user);

  const [fullName, setFullName] = useState(currentUser?.fullName?.split("-")[0] ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ user: User; accessToken: string }>("/api/v1/auth/register", {
        fullName,
        email,
        password,
        role: "deaf_user",
        preferredSignLanguage: currentUser?.preferredSignLanguage ?? "ASL",
        preferredSpokenLanguage: currentUser?.preferredSpokenLanguage ?? "en",
      });
      setSession(res.user, res.accessToken);
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas px-4 dark:bg-canvas-dark">
      <ScreenHeader title="Create account" subtitle="Save your history and progress across devices" />

      <form onSubmit={handleSubmit} className="mx-auto max-w-md space-y-4 px-2 pt-4">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink-700 dark:text-signal-100">
            <UserIcon size={16} /> Full name
          </span>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border-2 border-signal-100 bg-white px-4 py-3 text-lg dark:bg-surface-dark dark:border-ink-700 dark:text-white"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink-700 dark:text-signal-100">
            <Mail size={16} /> Email
          </span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border-2 border-signal-100 bg-white px-4 py-3 text-lg dark:bg-surface-dark dark:border-ink-700 dark:text-white"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink-700 dark:text-signal-100">
            <Lock size={16} /> Password
          </span>
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border-2 border-signal-100 bg-white px-4 py-3 text-lg dark:bg-surface-dark dark:border-ink-700 dark:text-white"
          />
          <span className="mt-1 block text-xs text-ink-500 dark:text-signal-100">At least 8 characters</span>
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-urgent">
            {error}
          </p>
        )}

        <BigButton type="submit" size="large" className="w-full" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </BigButton>
      </form>
    </main>
  );
}
