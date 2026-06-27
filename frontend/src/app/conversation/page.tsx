"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { CameraView } from "@/components/CameraView";
import { BigButton } from "@/components/BigButton";
import { BottomNav } from "@/components/BottomNav";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { useRecognitionSocket } from "@/hooks/useRecognitionSocket";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { speechLocaleFor } from "@/types";
import type { TranslationSession, Utterance } from "@/types";

interface ChatTurn {
  id: string;
  from: "signer" | "speaker";
  text: string;
  confidence?: number;
}

export default function ConversationPage() {
  const user = useAppStore((s) => s.user);
  const [cameraActive, setCameraActive] = useState(false);
  const [session, setSession] = useState<TranslationSession | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const drainRef = useRef<(() => any[]) | null>(null);
  const { speak } = useTextToSpeech();

  const signLanguage = user?.preferredSignLanguage ?? "ASL";
  const { latestUtterance, lowConfidence, sendFrames, connected } = useRecognitionSocket(
    session?.id ?? null,
    signLanguage
  );
  const { supported, listening, transcript, start, stop } = useSpeechToText(
    speechLocaleFor(user?.preferredSpokenLanguage)
  );

  useEffect(() => {
    if (!user) return;
    api
      .post<{ session: TranslationSession }>("/api/v1/sessions", {
        mode: "two_way",
        signLanguage,
        outputLanguage: user.preferredSpokenLanguage,
      })
      .then((res) => setSession(res.session))
      .catch(() => setSession(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!cameraActive) return;
    const interval = setInterval(() => {
      const frames = drainRef.current?.();
      if (frames && frames.length > 0) sendFrames(frames);
    }, 800);
    return () => clearInterval(interval);
  }, [cameraActive, sendFrames]);

  // New sign recognition -> add as a "signer" turn, auto-speak for the hearing person
  const lastUtteranceId = useRef<string | null>(null);
  useEffect(() => {
    if (!latestUtterance || latestUtterance.id === lastUtteranceId.current) return;
    lastUtteranceId.current = latestUtterance.id;
    setTurns((t) => [
      ...t,
      { id: latestUtterance.id, from: "signer", text: latestUtterance.recognized_text, confidence: latestUtterance.confidence_score },
    ]);
    speak(latestUtterance.recognized_text, speechLocaleFor(user?.preferredSpokenLanguage));
  }, [latestUtterance]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hearing person finishes speaking -> add as a "speaker" turn
  function handleStopListening() {
    stop();
    if (transcript.trim()) {
      setTurns((t) => [...t, { id: crypto.randomUUID(), from: "speaker", text: transcript.trim() }]);
    }
  }

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <ScreenHeader title="Two-Way Conversation" subtitle="Sign and speak — both sides are translated live" />

      <section className="space-y-4 px-4">
        <CameraView
          active={cameraActive}
          onToggle={setCameraActive}
          onFramesReady={(drain) => {
            drainRef.current = drain;
          }}
        />

        {!supported && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Voice input isn&apos;t supported in this browser. Try Chrome or Edge for the hearing person&apos;s side.
          </p>
        )}

        {supported && (
          <div className="flex items-center justify-center">
            <BigButton
              size="large"
              variant={listening ? "urgent" : "primary"}
              icon={listening ? <MicOff size={22} /> : <Mic size={22} />}
              onClick={listening ? handleStopListening : start}
            >
              {listening ? "Stop & Send" : "Hearing person: tap to speak"}
            </BigButton>
          </div>
        )}

        {listening && transcript && (
          <p className="rounded-xl border border-signal-100 bg-white px-4 py-3 text-lg text-ink-700 dark:bg-surface-dark dark:text-signal-100 dark:border-ink-700">
            {transcript}
          </p>
        )}

        <div className="space-y-3">
          {turns.length === 0 && (
            <p className="py-8 text-center text-ink-500 dark:text-signal-100">
              The conversation will appear here as you sign and speak.
            </p>
          )}
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                turn.from === "signer"
                  ? "ml-0 bg-signal text-white"
                  : "ml-auto bg-white text-ink-900 border border-signal-100 dark:bg-surface-dark dark:text-white dark:border-ink-700"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide opacity-75">
                {turn.from === "signer" ? "Signed" : "Spoken"}
              </p>
              <p className="mt-1 text-lg">{turn.text}</p>
              {turn.confidence !== undefined && (
                <div className="mt-2">
                  <ConfidenceIndicator confidence={turn.confidence} />
                </div>
              )}
              {turn.from === "speaker" && (
                <button
                  onClick={() => speak(turn.text, speechLocaleFor(user?.preferredSpokenLanguage))}
                  className="mt-2 flex items-center gap-1.5 text-sm font-medium opacity-80"
                >
                  <Volume2 size={14} /> Replay
                </button>
              )}
            </div>
          ))}
        </div>

        {cameraActive && !connected && (
          <p className="text-center text-sm text-amber-700 dark:text-amber-300">Connecting to recognition service…</p>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
