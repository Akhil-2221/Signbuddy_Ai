"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, X, Play, ArrowRight } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { CameraView } from "@/components/CameraView";
import { BigButton } from "@/components/BigButton";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { Lesson, SignDictionaryEntry } from "@/types";

interface PracticeResult {
  predictedGloss: string;
  confidence: number;
  isCorrect: boolean;
}

export default function LessonPracticePage() {
  const params = useParams<{ lessonId: string }>();
  const router = useRouter();
  const user = useAppStore((s) => s.user);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [signs, setSigns] = useState<SignDictionaryEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const drainRef = useRef<(() => any[]) | null>(null);

  useEffect(() => {
    api
      .get<{ lesson: Lesson; signs: SignDictionaryEntry[] }>(`/api/v1/tutor/lessons/${params.lessonId}`)
      .then((res) => {
        setLesson(res.lesson);
        setSigns(res.signs);
      });
  }, [params.lessonId]);

  const currentSign = signs[currentIndex];

  async function handleTryNow() {
    if (!currentSign) return;
    const frames = drainRef.current?.();
    if (!frames || frames.length === 0) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ result: PracticeResult }>("/api/v1/tutor/practice", {
        signId: currentSign.id,
        signLanguage: currentSign.sign_language,
        frames,
        lessonId: lesson?.id,
      });
      setResult(res.result);
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    setResult(null);
    if (currentIndex < signs.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      api.post(`/api/v1/tutor/lessons/${lesson?.id}/complete`).finally(() => router.push("/learn"));
    }
  }

  if (!lesson || !currentSign) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas dark:bg-canvas-dark">
        <p className="text-ink-500 dark:text-signal-100">Loading lesson…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas pb-16 dark:bg-canvas-dark">
      <ScreenHeader
        title={lesson.title}
        subtitle={`Sign ${currentIndex + 1} of ${signs.length}`}
      />

      <section className="space-y-5 px-4">
        <div className="rounded-2xl border border-signal-100 bg-white p-5 text-center dark:bg-surface-dark dark:border-ink-700">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-signal-100">
            Try signing
          </p>
          <p className="mt-1 font-display text-3xl font-extrabold text-signal">{currentSign.gloss}</p>
          {currentSign.instructions_text && (
            <p className="mt-3 text-ink-700 dark:text-signal-100">{currentSign.instructions_text}</p>
          )}
          <video
            src={currentSign.video_url}
            controls
            className="mx-auto mt-4 max-h-48 rounded-xl bg-ink-900"
          >
            Reference video unavailable
          </video>
        </div>

        <CameraView
          active={cameraActive}
          onToggle={setCameraActive}
          onFramesReady={(drain) => {
            drainRef.current = drain;
          }}
        />

        {!result && (
          <BigButton
            size="large"
            className="w-full"
            icon={<Play size={20} />}
            onClick={handleTryNow}
            disabled={!cameraActive || submitting}
          >
            {submitting ? "Checking…" : "I'm ready — check my sign"}
          </BigButton>
        )}

        {result && (
          <div
            className={`rounded-2xl border-2 p-5 text-center ${
              result.isCorrect ? "border-signal bg-signal-50 dark:bg-ink-700" : "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
            }`}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white dark:bg-surface-dark">
              {result.isCorrect ? <Check className="text-signal" size={28} /> : <X className="text-amber-600" size={28} />}
            </div>
            <p className="mt-3 font-display text-lg font-bold text-ink-900 dark:text-white">
              {result.isCorrect ? "Nice! That looked right." : "Close — keep practicing this one."}
            </p>
            <div className="mt-3">
              <ConfidenceIndicator confidence={result.confidence} />
            </div>
            <BigButton className="mt-5" icon={<ArrowRight size={18} />} onClick={handleNext}>
              {currentIndex < signs.length - 1 ? "Next sign" : "Finish lesson"}
            </BigButton>
          </div>
        )}
      </section>
    </main>
  );
}
