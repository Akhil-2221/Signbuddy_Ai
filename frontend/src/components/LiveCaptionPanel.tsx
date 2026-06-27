"use client";

import { useState } from "react";
import { Volume2, Edit3, Check, AlertTriangle } from "lucide-react";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { BigButton } from "@/components/BigButton";
import type { Utterance } from "@/types";

interface LiveCaptionPanelProps {
  utterance: Utterance | null;
  lowConfidence: boolean;
  onSpeak: (text: string) => void;
  onCorrect: (utteranceId: string, correctedText: string) => void;
}

export function LiveCaptionPanel({ utterance, lowConfidence, onSpeak, onCorrect }: LiveCaptionPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!utterance) {
    return (
      <div className="rounded-2xl border border-signal-100 bg-white px-6 py-10 text-center dark:bg-surface-dark dark:border-ink-700">
        <p className="text-lg text-ink-500 dark:text-signal-100">
          Start signing — your translation will appear here.
        </p>
      </div>
    );
  }

  const displayText = utterance.user_corrected_text || utterance.recognized_text;

  return (
    <div className="rounded-2xl border border-signal-100 bg-white p-6 dark:bg-surface-dark dark:border-ink-700">
      {editing ? (
        <div className="space-y-3">
          <label htmlFor="correction" className="text-sm font-medium text-ink-500 dark:text-signal-100">
            Edit the text below
          </label>
          <input
            id="correction"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-xl border-2 border-signal bg-canvas px-4 py-3 text-xl dark:bg-ink-900 dark:text-white"
          />
          <div className="flex gap-3">
            <BigButton
              icon={<Check size={18} />}
              onClick={() => {
                onCorrect(utterance.id, draft);
                setEditing(false);
              }}
            >
              Save
            </BigButton>
            <BigButton variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </BigButton>
          </div>
        </div>
      ) : (
        <>
          <p className="font-display text-2xl font-bold leading-snug text-ink-900 dark:text-white">
            {displayText}
          </p>

          <div className="mt-4">
            <ConfidenceIndicator confidence={utterance.confidence_score} />
          </div>

          {lowConfidence && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              <AlertTriangle size={16} />
              Not fully sure about this one. You can correct it below.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <BigButton icon={<Volume2 size={18} />} onClick={() => onSpeak(displayText)}>
              Speak this
            </BigButton>
            <BigButton
              variant="secondary"
              icon={<Edit3 size={18} />}
              onClick={() => {
                setDraft(displayText);
                setEditing(true);
              }}
            >
              Correct
            </BigButton>
          </div>
        </>
      )}
    </div>
  );
}
