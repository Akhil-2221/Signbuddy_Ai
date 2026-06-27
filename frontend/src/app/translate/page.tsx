"use client";

import { useEffect, useRef, useState } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { CameraView } from "@/components/CameraView";
import { LiveCaptionPanel } from "@/components/LiveCaptionPanel";
import { OutputModeToggle } from "@/components/OutputModeToggle";
import { BottomNav } from "@/components/BottomNav";
import { useRecognitionSocket } from "@/hooks/useRecognitionSocket";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { speechLocaleFor } from "@/types";
import type { OutputPreference, TranslationSession, Utterance } from "@/types";

export default function TranslatePage() {
  const user = useAppStore((s) => s.user);
  const [cameraActive, setCameraActive] = useState(false);
  const [session, setSession] = useState<TranslationSession | null>(null);
  const [outputMode, setOutputMode] = useState<OutputPreference>(user?.preferredOutput ?? "both");
  const [history, setHistory] = useState<Utterance[]>([]);
  const drainRef = useRef<(() => any[]) | null>(null);
  const { speak } = useTextToSpeech();

  const signLanguage = user?.preferredSignLanguage ?? "ASL";
  const { latestUtterance, lowConfidence, sendFrames, connected, socketError } = useRecognitionSocket(
    session?.id ?? null,
    signLanguage
  );

  // Start a backend session once the user is known
  useEffect(() => {
    if (!user) return;
    api
      .post<{ session: TranslationSession }>("/api/v1/sessions", {
        mode: outputMode === "speech" ? "sign_to_speech" : "sign_to_text",
        signLanguage,
        outputLanguage: user.preferredSpokenLanguage,
        deviceType: /Mobi/.test(navigator.userAgent) ? "mobile" : "desktop",
      })
      .then((res) => setSession(res.session))
      .catch(() => setSession(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Periodically flush the landmark frame buffer over the WebSocket
  useEffect(() => {
    if (!cameraActive) return;
    const interval = setInterval(() => {
      const frames = drainRef.current?.();
      if (frames && frames.length > 0) sendFrames(frames);
    }, 800); // batch every 800ms — balances latency vs. network chatter
    return () => clearInterval(interval);
  }, [cameraActive, sendFrames]);

  // Auto-speak new recognitions when output mode includes speech
  useEffect(() => {
    if (!latestUtterance) return;
    setHistory((h) => [...h, latestUtterance]);
    if (outputMode === "speech" || outputMode === "both") {
      speak(latestUtterance.recognized_text, speechLocaleFor(user?.preferredSpokenLanguage), user?.accessibilitySettings.voiceSpeed);
    }
  }, [latestUtterance]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCorrect(utteranceId: string, correctedText: string) {
    await api.patch(`/api/v1/sessions/utterances/${utteranceId}/correct`, { correctedText });
    setHistory((h) => h.map((u) => (u.id === utteranceId ? { ...u, user_corrected_text: correctedText } : u)));
  }

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <ScreenHeader
        title="Translate"
        subtitle={`${signLanguage} → ${outputMode === "both" ? "Text & Speech" : outputMode === "speech" ? "Speech" : "Text"}`}
        right={<OutputModeToggle value={outputMode} onChange={setOutputMode} />}
      />

      <section className="space-y-4 px-4">
        <CameraView
          active={cameraActive}
          onToggle={setCameraActive}
          onFramesReady={(drain) => {
            drainRef.current = drain;
          }}
        />

        {cameraActive && !connected && (
          <p className="text-center text-sm text-amber-700 dark:text-amber-300">Connecting to recognition service…</p>
        )}
        {socketError && (
          <p role="alert" className="text-center text-sm font-medium text-urgent">
            {socketError}
          </p>
        )}

        <LiveCaptionPanel
          utterance={latestUtterance}
          lowConfidence={lowConfidence}
          onSpeak={(text) => speak(text, speechLocaleFor(user?.preferredSpokenLanguage), user?.accessibilitySettings.voiceSpeed)}
          onCorrect={handleCorrect}
        />

        {history.length > 1 && (
          <div className="rounded-2xl border border-signal-100 bg-white p-4 dark:bg-surface-dark dark:border-ink-700">
            <h2 className="mb-2 text-sm font-semibold text-ink-500 dark:text-signal-100">Earlier in this session</h2>
            <ul className="space-y-1.5">
              {history
                .slice(0, -1)
                .reverse()
                .map((u) => (
                  <li key={u.id} className="text-ink-700 dark:text-signal-100">
                    {u.user_corrected_text || u.recognized_text}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
