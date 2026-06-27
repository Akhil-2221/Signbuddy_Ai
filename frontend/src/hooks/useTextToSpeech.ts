"use client";

import { useCallback, useState } from "react";

/**
 * REAL — uses the browser's native Web Speech API (SpeechSynthesis).
 * No API key, no backend call, works the moment the page loads.
 * This is the actual "sign → speech" output mechanism in this build.
 */
export function useTextToSpeech() {
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback((text: string, lang: string = "en-US", rate: number = 1.0) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // stop any current utterance before starting a new one
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, []);

  return { speak, stop, speaking };
}
