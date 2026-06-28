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

/**
 * translate/page.tsx — Production fix.
 *
 * CAUSE 7 ── TTS called with empty string
 *   Original: speak(latestUtterance.recognized_text, ...) was unconditional.
 *   When recognized_text was "" (classifier suppressed), SpeechSynthesis
 *   received an empty utterance, silently failed, and blocked the speech queue.
 *   Subsequent real words were never spoken.
 *   FIX: Guard speak() — only call when recognized_text is non-empty.
 *
 * CAUSE 8 ── History bloated with empty/duplicate entries
 *   Every latestUtterance change (including empties) was pushed to history.
 *   After 2 minutes of signing, history had hundreds of blank entries.
 *   FIX: Skip empty text; deduplicate consecutive identical words.
 *
 * CAUSE 9 ── 800ms drain interval created 800ms recognition lag
 *   At 15fps (post-fix), 800ms = 12 frames per batch. The classifier needs
 *   15 frames minimum before inferring. With 800ms batches, the first
 *   inference fires after 2 batches = 1.6 seconds of lag.
 *   FIX: 300ms drain interval. At 15fps, 300ms = ~5 frames per batch.
 *   The classifier accumulates across batches in its rolling buffer.
 *   First inference fires after 3 batches = 900ms — feels near-instant.
 */
export default function TranslatePage() {
  const user = useAppStore((s) => s.user);
  const [cameraActive, setCameraActive] = useState(false);
  const [session,      setSession]      = useState<TranslationSession | null>(null);
  const [outputMode,   setOutputMode]   = useState<OutputPreference>(
    user?.preferredOutput ?? "both"
  );
  const [history, setHistory] = useState<Utterance[]>([]);
  const drainRef  = useRef<(() => any[]) | null>(null);
  const { speak } = useTextToSpeech();

  const signLanguage = user?.preferredSignLanguage ?? "ISL";
  const { latestUtterance, lowConfidence, sendFrames, connected, socketError } =
    useRecognitionSocket(session?.id ?? null, signLanguage);

  // Start backend session
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

  // FIX 9: 300ms drain interval for low-latency recognition
  useEffect(() => {
    if (!cameraActive) return;
    const interval = setInterval(() => {
      const frames = drainRef.current?.();
      if (frames && frames.length > 0) sendFrames(frames);
    }, 300);
    return () => clearInterval(interval);
  }, [cameraActive, sendFrames]);

  // FIX 7 + 8: Guard empty text and deduplicate history
  useEffect(() => {
    if (!latestUtterance) return;

    // FIX 7: skip empty recognized_text entirely
    const text = latestUtterance.recognized_text?.trim();
    if (!text) return;

    // FIX 8: don't add consecutive identical words to history
    setHistory((h) => {
      const last = h[h.length - 1];
      if (last?.recognized_text === text) return h;
      return [...h, latestUtterance];
    });

    // FIX 7: only speak non-empty text
    if (outputMode === "speech" || outputMode === "both") {
      speak(
        text,
        speechLocaleFor(user?.preferredSpokenLanguage),
        user?.accessibilitySettings.voiceSpeed
      );
    }
  }, [latestUtterance]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCorrect(utteranceId: string, correctedText: string) {
    await api.patch(`/api/v1/sessions/utterances/${utteranceId}/correct`, {
      correctedText,
    });
    setHistory((h) =>
      h.map((u) =>
        u.id === utteranceId ? { ...u, user_corrected_text: correctedText } : u
      )
    );
  }

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <ScreenHeader
        title="Translate"
        subtitle={`${signLanguage} → ${
          outputMode === "both"
            ? "Text & Speech"
            : outputMode === "speech"
            ? "Speech"
            : "Text"
        }`}
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
          <p className="text-center text-sm text-amber-700 dark:text-amber-300">
            Connecting to recognition service…
          </p>
        )}
        {socketError && (
          <p role="alert" className="text-center text-sm font-medium text-urgent">
            {socketError}
          </p>
        )}

        <LiveCaptionPanel
          utterance={latestUtterance}
          lowConfidence={lowConfidence}
          onSpeak={(text) =>
            speak(
              text,
              speechLocaleFor(user?.preferredSpokenLanguage),
              user?.accessibilitySettings.voiceSpeed
            )
          }
          onCorrect={handleCorrect}
        />

        {history.length > 1 && (
          <div className="rounded-2xl border border-signal-100 bg-white p-4 dark:bg-surface-dark dark:border-ink-700">
            <h2 className="mb-2 text-sm font-semibold text-ink-500 dark:text-signal-100">
              Earlier in this session
            </h2>
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
