"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * REAL — uses the browser's native Web Speech API (SpeechRecognition) where
 * available (Chrome, Edge, Safari). This is genuinely live, no mock involved.
 * Falls back with a clear `supported: false` flag on browsers without it
 * (notably Firefox) so the UI can show an honest message instead of failing silently.
 */
export function useSpeechToText(lang: string = "en-US") {
  const recognitionRef = useRef<any>(null);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: any) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        finalText += event.results[i][0].transcript;
      }
      setTranscript(finalText);
    };
    recognition.onerror = (event: any) => setError(event.error);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, [lang]);

  const start = useCallback(() => {
    setError(null);
    setTranscript("");
    recognitionRef.current?.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, transcript, error, start, stop };
}
