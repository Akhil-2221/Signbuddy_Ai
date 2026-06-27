"use client";

import { useEffect, useState } from "react";
import { Clock, MessageSquareText, Camera, Siren } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { BottomNav } from "@/components/BottomNav";
import { api } from "@/lib/api";
import type { TranslationSession } from "@/types";

const MODE_ICON: Record<string, typeof Camera> = {
  sign_to_text: Camera,
  sign_to_speech: Camera,
  speech_to_text: MessageSquareText,
  two_way: MessageSquareText,
  emergency: Siren,
};

const MODE_LABEL: Record<string, string> = {
  sign_to_text: "Sign → Text",
  sign_to_speech: "Sign → Speech",
  speech_to_text: "Speech → Text",
  two_way: "Two-Way Conversation",
  emergency: "Emergency",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<TranslationSession[] | null>(null);

  useEffect(() => {
    api
      .get<{ sessions: TranslationSession[] }>("/api/v1/sessions?limit=50")
      .then((res) => setSessions(res.sessions))
      .catch(() => setSessions([]));
  }, []);

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <ScreenHeader title="History" subtitle="Your past conversations" />

      <section className="space-y-3 px-4">
        {sessions === null && (
          <p className="py-10 text-center text-ink-500 dark:text-signal-100">Loading…</p>
        )}
        {sessions?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-signal-100 px-6 py-10 text-center dark:border-ink-700">
            <Clock size={32} className="mx-auto mb-3 text-ink-500 dark:text-signal-100" />
            <p className="text-ink-700 dark:text-signal-100">No conversations yet. Start translating to see your history here.</p>
          </div>
        )}
        {sessions?.map((s) => {
          const Icon = MODE_ICON[s.mode] ?? Camera;
          return (
            <div
              key={s.id}
              className="flex items-center gap-4 rounded-2xl border border-signal-100 bg-white px-5 py-4 dark:bg-surface-dark dark:border-ink-700"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal-50 text-signal dark:bg-ink-700 dark:text-signal-100">
                <Icon size={20} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-ink-900 dark:text-white">{MODE_LABEL[s.mode] ?? s.mode}</p>
                <p className="text-sm text-ink-500 dark:text-signal-100">
                  {s.sign_language} · {formatDate(s.started_at)}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      <BottomNav />
    </main>
  );
}
