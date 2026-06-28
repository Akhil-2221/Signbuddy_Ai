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
 * useRecognitionSocket — Fixed version (minimal changes from original).
 *
 * WHAT WAS WRONG:
 *
 * FIX 1 — Empty text utterances were shown / replacing valid predictions:
 *   When the AI classifier returns "" (low confidence suppressed), the backend
 *   was still inserting a DB row and sending it over WebSocket. The frontend
 *   then called setLatestUtterance() with an utterance whose recognized_text=""
 *   — wiping the previously displayed word. The UI went blank between signs.
 *   FIX: Skip setLatestUtterance() when recognized_text is empty or whitespace.
 *
 * FIX 2 — WebSocket never reconnected after a disconnect:
 *   The original code had no reconnect logic. If the backend restarted or the
 *   connection dropped briefly, the user had to refresh the page.
 *   FIX: Add exponential-backoff auto-reconnect (max 5 attempts, max 8s delay).
 *   This prevents the "Connecting..." spinner getting stuck forever.
 *
 * Everything else (sendFrames, sessionId dependency, error states) is UNCHANGED.
 */
export function useRecognitionSocket(sessionId: string | null, signLanguage: SignLanguage) {
  const wsRef            = useRef<WebSocket | null>(null);
  const [connected, setConnected]           = useState(false);
  const [latestUtterance, setLatestUtterance] = useState<Utterance | null>(null);
  const [lowConfidence, setLowConfidence]   = useState(false);
  const [socketError, setSocketError]       = useState<string | null>(null);
  const sequenceRef      = useRef(0);
  const reconnectRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef      = useRef(0);
  const mountedRef       = useRef(true);

  const connect = useCallback(() => {
    if (!sessionId) return;
    if (!mountedRef.current) return;

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
      attemptsRef.current = 0;  // reset backoff counter on successful connect
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);

      // FIX 2: Auto-reconnect with exponential backoff
      if (attemptsRef.current < 5) {
        const delay = Math.min(1000 * Math.pow(2, attemptsRef.current), 8000);
        attemptsRef.current++;
        reconnectRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      } else {
        setSocketError("Connection lost. Please refresh the page.");
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setSocketError("Connection error — retrying…");
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg: RecognitionMessage = JSON.parse(event.data);

        if (msg.type === "recognition_result" && msg.utterance) {
          // FIX 1: Only update UI when there is actual text.
          // Empty string means the AI suppressed a low-confidence result —
          // keep the previous word on screen rather than blanking it.
          if (
            msg.utterance.recognized_text &&
            msg.utterance.recognized_text.trim() !== ""
          ) {
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
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
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
