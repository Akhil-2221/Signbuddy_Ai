"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandmarkFrame, SignLanguage, Utterance } from "@/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000";

interface RecognitionMessage {
  type: "recognition_result" | "error";
  utterance?: Utterance;
  fallbackSuggested?: boolean;
  message?: string;
}

/**
 * useRecognitionSocket — Production fix.
 *
 * CAUSE 5 ── Empty-text utterances wiped the caption panel
 *   When the AI classifier suppressed a low-confidence result (text=""),
 *   the backend still sent it over WebSocket. setLatestUtterance() was
 *   called with empty text, blanking whatever word was displayed.
 *   The user saw the word flash and disappear, or the panel stayed blank.
 *   FIX: Only call setLatestUtterance() when recognized_text is non-empty.
 *
 * CAUSE 6 ── No WebSocket reconnection after drop
 *   If the backend restarted, the connection was lost permanently.
 *   FIX: Exponential-backoff auto-reconnect (max 5 attempts, max 8s delay).
 *
 * CAUSE 7 ── TTS was called with empty string
 *   translate/page.tsx called speak(latestUtterance.recognized_text, ...)
 *   even when text was "". SpeechSynthesis with empty text fails silently
 *   or resets the queue, preventing subsequent speaks from firing.
 *   FIX: Guard in translate/page.tsx (see that file).
 */
export function useRecognitionSocket(sessionId: string | null, signLanguage: SignLanguage) {
  const wsRef              = useRef<WebSocket | null>(null);
  const [connected, setConnected]             = useState(false);
  const [latestUtterance, setLatestUtterance] = useState<Utterance | null>(null);
  const [lowConfidence, setLowConfidence]     = useState(false);
  const [socketError, setSocketError]         = useState<string | null>(null);
  const sequenceRef    = useRef(0);
  const attemptsRef    = useRef(0);
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef     = useRef(true);

  const connect = useCallback(() => {
    if (!sessionId || !mountedRef.current) return;

    const token =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("sb_access_token")
        : null;

    if (!token) {
      setSocketError("Not authenticated");
      return;
    }

    const ws = new WebSocket(
      `${WS_URL}/ws/recognize?token=${encodeURIComponent(token)}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setSocketError(null);
      attemptsRef.current = 0;
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      // FIX 6: exponential backoff reconnect
      if (attemptsRef.current < 5) {
        const delay = Math.min(500 * 2 ** attemptsRef.current, 8000);
        attemptsRef.current++;
        reconnTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      } else {
        setSocketError("Connection lost. Please refresh the page.");
      }
    };

    ws.onerror = () => {
      if (mountedRef.current) setSocketError("Connection error — retrying…");
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg: RecognitionMessage = JSON.parse(event.data);

        if (msg.type === "recognition_result" && msg.utterance) {
          // FIX 5: Only update when there is real text.
          // Empty string = classifier suppressed this frame. Keep last word visible.
          if (msg.utterance.recognized_text?.trim()) {
            setLatestUtterance(msg.utterance);
            setLowConfidence(!!msg.fallbackSuggested);
          }
          setSocketError(null);
        } else if (msg.type === "error") {
          setSocketError(msg.message ?? "Recognition error");
        }
      } catch {
        setSocketError("Received malformed response");
      }
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendFrames = useCallback(
    (frames: LandmarkFrame[]) => {
      if (
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN ||
        frames.length === 0
      )
        return;
      wsRef.current.send(
        JSON.stringify({
          type: "frame_batch",
          sessionId,
          signLanguage,
          sequenceIndex: sequenceRef.current++,
          frames,
        })
      );
    },
    [sessionId, signLanguage]
  );

  return { connected, latestUtterance, lowConfidence, socketError, sendFrames };
}
