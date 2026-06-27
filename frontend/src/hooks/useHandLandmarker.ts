"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandmarkFrame } from "@/types";

/**
 * REAL — genuinely runs MediaPipe Tasks Vision (HandLandmarker) live in the browser.
 * This is the actual computer-vision piece that works today, independent of any
 * trained classifier: it detects hand keypoints from the webcam feed in real time.
 *
 * What it does NOT do: turn those keypoints into recognized words. That's the
 * classifier's job (currently mocked server-side — see ai-service/pipeline/sign_classifier.py).
 */

type DetectorStatus = "idle" | "loading" | "ready" | "error";

export function useHandLandmarker(videoRef: React.RefObject<HTMLVideoElement>) {
  const [status, setStatus] = useState<DetectorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handsDetected, setHandsDetected] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  const landmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const frameBufferRef = useRef<LandmarkFrame[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setStatus("loading");
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { HandLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        const landmarker = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });

        if (cancelled) return;
        landmarkerRef.current = landmarker;
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load hand detector");
        setStatus("error");
      }
    }

    init();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const detectFrame = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || video.readyState < 2) return;

    const result = landmarker.detectForVideo(video, performance.now());

    let left: number[][] | null = null;
    let right: number[][] | null = null;

    if (result.landmarks && result.landmarks.length > 0) {
      result.landmarks.forEach((handLandmarks: any[], idx: number) => {
        const coords = handLandmarks.map((lm) => [lm.x, lm.y, lm.z]);
        const handedness = result.handedness?.[idx]?.[0]?.categoryName;
        if (handedness === "Left") left = coords;
        else if (handedness === "Right") right = coords;
      });
    }

    setHandsDetected({ left: !!left, right: !!right });

    frameBufferRef.current.push({
      hand_landmarks_left: left,
      hand_landmarks_right: right,
      pose_landmarks: null,
      face_landmarks: null,
      timestamp_ms: Date.now(),
    });

    // Keep a rolling buffer of the last ~2 seconds at ~30fps
    if (frameBufferRef.current.length > 60) {
      frameBufferRef.current.shift();
    }
  }, [videoRef]);

  const startLoop = useCallback(() => {
    const loop = () => {
      detectFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [detectFrame]);

  const stopLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const drainFrameBuffer = useCallback((): LandmarkFrame[] => {
    const frames = [...frameBufferRef.current];
    frameBufferRef.current = [];
    return frames;
  }, []);

  return { status, error, handsDetected, startLoop, stopLoop, drainFrameBuffer };
}
