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
 * Streams landmark frame batches to the backend over a persistent WebSocket
 * for low-latency live recognition. Falls back gracefully with an error
 * state the UI can show — never silently fails.
 */
export function useRecognitionSocket(sessionId: string | null, signLanguage: SignLanguage) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [latestUtterance, setLatestUtterance] = useState<Utterance | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    if (!sessionId) return;
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem("sb_access_token") : null;
    if (!token) {
      setSocketError("Not authenticated");
      return;
    }

    const ws = new WebSocket(`${WS_URL}/ws/recognize?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setSocketError("Connection lost. Retrying may help.");

    ws.onmessage = (event) => {
      try {
        const msg: RecognitionMessage = JSON.parse(event.data);
        if (msg.type === "recognition_result" && msg.utterance) {
          setLatestUtterance(msg.utterance);
          setLowConfidence(!!msg.fallbackSuggested);
          setSocketError(null);
        } else if (msg.type === "error") {
          setSocketError(msg.message ?? "Recognition error");
        }
      } catch {
        setSocketError("Received malformed response");
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const sendFrames = useCallback(
    (frames: LandmarkFrame[]) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || frames.length === 0) return;
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
