"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, Sparkles, ChevronRight } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { BottomNav } from "@/components/BottomNav";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Lesson } from "@/types";

interface ProgressRow {
  lesson_id: string;
  status: string;
  best_score: number | null;
}

export default function LearnPage() {
  const user = useAppStore((s) => s.user);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [recommended, setRecommended] = useState<Lesson | null>(null);

  const signLanguage = user?.preferredSignLanguage ?? "ASL";

  useEffect(() => {
    api.get<{ lessons: Lesson[] }>(`/api/v1/tutor/lessons?signLanguage=${signLanguage}`).then((r) => setLessons(r.lessons));
    if (user) {
      api.get<{ progress: ProgressRow[] }>("/api/v1/tutor/progress").then((r) => setProgress(r.progress));
      api
        .get<{ nextLesson: Lesson | null }>(`/api/v1/tutor/recommendations?signLanguage=${signLanguage}`)
        .then((r) => setRecommended(r.nextLesson));
    }
  }, [signLanguage, user?.id]);

  function progressFor(lessonId: string) {
    return progress.find((p) => p.lesson_id === lessonId);
  }

  return (
    <main className="min-h-screen bg-canvas pb-28 dark:bg-canvas-dark">
      <ScreenHeader title="Learn Signs" subtitle="Your personal AI sign language tutor" />

      {recommended && (
        <section className="mx-4 mb-6 rounded-2xl bg-signal px-6 py-5 text-white">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide opacity-90">
            <Sparkles size={16} /> Recommended next
          </p>
          <h2 className="mt-1 font-display text-xl font-bold">{recommended.title}</h2>
          <p className="mt-1 text-sm opacity-90">{recommended.description}</p>
          <Link
            href={`/learn/${recommended.id}`}
            className="mt-4 inline-flex items-center gap-1 rounded-xl bg-white/15 px-4 py-2 font-semibold backdrop-blur"
          >
            Continue <ChevronRight size={16} />
          </Link>
        </section>
      )}

      <section className="space-y-3 px-4">
        {lessons.map((lesson) => {
          const p = progressFor(lesson.id);
          return (
            <Link
              key={lesson.id}
              href={`/learn/${lesson.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-signal-100 bg-white px-5 py-4 dark:bg-surface-dark dark:border-ink-700"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal-50 text-signal dark:bg-ink-700 dark:text-signal-100">
                  <GraduationCap size={22} />
                </div>
                <div>
                  <p className="font-display font-semibold text-ink-900 dark:text-white">{lesson.title}</p>
                  <p className="text-sm text-ink-500 dark:text-signal-100">
                    {p?.status === "completed"
                      ? "Completed"
                      : p?.status === "in_progress"
                      ? `In progress · best ${Math.round(p.best_score ?? 0)}%`
                      : "Not started"}
                  </p>
                </div>
              </div>
              <ChevronRight size={20} className="text-ink-500 dark:text-signal-100" />
            </Link>
          );
        })}

        {lessons.length === 0 && (
          <p className="py-10 text-center text-ink-500 dark:text-signal-100">Loading lessons…</p>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
