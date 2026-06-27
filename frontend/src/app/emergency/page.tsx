"use client";

import { useEffect, useState } from "react";
import { Volume2, Siren } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { BottomNav } from "@/components/BottomNav";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { speechLocaleFor } from "@/types";
import type { EmergencyPhrase } from "@/types";

export default function EmergencyPage() {
  const user = useAppStore((s) => s.user);
  const [phrases, setPhrases] = useState<EmergencyPhrase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { speak, speaking } = useTextToSpeech();

  const signLanguage = user?.preferredSignLanguage ?? "ASL";
  const spokenLang = user?.preferredSpokenLanguage ?? "en";

  useEffect(() => {
    api
      .get<{ phrases: EmergencyPhrase[] }>(`/api/v1/emergency-phrases?signLanguage=${signLanguage}`)
      .then((res) => setPhrases(res.phrases))
      .catch(() => setPhrases([]));
  }, [signLanguage]);

  function handleTap(phrase: EmergencyPhrase) {
    setActiveId(phrase.id);
    const text = phrase.translations[spokenLang] ?? phrase.display_text_en;
    speak(text, speechLocaleFor(spokenLang), 1.0);
  }

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <div className="bg-urgent px-4 pb-6 pt-6 text-white">
        <div className="flex items-center gap-2">
          <Siren size={26} />
          <h1 className="font-display text-2xl font-extrabold">Emergency</h1>
        </div>
        <p className="mt-1 text-white/90">Tap a phrase — it will be spoken aloud immediately.</p>
      </div>

      <section className="grid grid-cols-1 gap-4 px-4 pt-6 sm:grid-cols-2">
        {phrases.length === 0 && (
          <p className="col-span-full py-10 text-center text-ink-500 dark:text-signal-100">Loading emergency phrases…</p>
        )}
        {phrases.map((phrase) => {
          const text = phrase.translations[spokenLang] ?? phrase.display_text_en;
          const isActive = activeId === phrase.id && speaking;
          return (
            <button
              key={phrase.id}
              onClick={() => handleTap(phrase)}
              className={`hc-border flex items-center justify-between gap-3 rounded-2xl border-2 px-6 py-6 text-left transition-colors ${
                isActive
                  ? "border-urgent bg-urgent-50 dark:bg-urgent/20"
                  : "border-signal-100 bg-white dark:bg-surface-dark dark:border-ink-700"
              }`}
            >
              <span className="font-display text-xl font-bold text-ink-900 dark:text-white">{text}</span>
              <Volume2
                size={26}
                className={isActive ? "text-urgent animate-pulseRing" : "text-ink-500 dark:text-signal-100"}
              />
            </button>
          );
        })}
      </section>

      <p className="px-4 pt-8 text-center text-sm text-ink-500 dark:text-signal-100">
        In a life-threatening emergency, also try to get the attention of anyone nearby and show them this screen.
      </p>

      <BottomNav />
    </main>
  );
}
