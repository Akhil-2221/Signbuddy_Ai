"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandmarkFrame } from "@/types";

/**
 * useHandLandmarker — Production fix. Original architecture preserved.
 *
 * ═══════════════════════════════════════════════════════
 * ROOT CAUSE AUDIT — WHY SIGNS WERE WRONG (Turtle, Hug)
 * ═══════════════════════════════════════════════════════
 *
 * CAUSE 1 ── 30fps inference vs 15fps training (PRIMARY cause of wrong labels)
 *   Training config: target_fps = 15
 *   The dataset videos were sampled at 15fps → the BiLSTM learned temporal
 *   patterns (hand velocity, transition timing) at 15fps resolution.
 *   This hook pushed EVERY requestAnimationFrame tick (~30fps) into the buffer.
 *   At 30fps, a 2-second "HELLO" sign produced ~60 frames.
 *   At 15fps (training), the same sign produced ~30 frames.
 *   The model received sequences with 2× the temporal density it was trained on.
 *   Every sign looked like a different, faster sign to the model → wrong labels.
 *   FIX: Gate frame capture to exactly 15fps (one frame every 66ms).
 *
 * CAUSE 2 ── Handedness swap on mirrored selfie camera
 *   The original code: handedness === "Left" → hand_landmarks_left
 *   Training used MediaPipe Holistic which reports anatomical handedness.
 *   MediaPipe Tasks API HandLandmarker reports handedness from the camera's
 *   perspective. On a mirrored selfie feed (-scale-x-100 in CameraView.tsx):
 *     Tasks "Left"  = appears on LEFT side of screen = user's RIGHT hand
 *     Tasks "Right" = appears on RIGHT side of screen = user's LEFT hand
 *   Every frame sent left=userRight, right=userLeft — mirror of training.
 *   FIX: Swap the assignment (Tasks "Left" → right, Tasks "Right" → left).
 *
 * CAUSE 3 ── pose_landmarks always null (44% feature mismatch)
 *   Training feature vector = 225 dims: left(63) + right(63) + pose(99).
 *   The original hook set pose_landmarks: null every frame.
 *   At inference, 99/225 = 44% of every input vector was always zero.
 *   The model had never seen this distribution during training.
 *   FIX: Add MediaPipe Tasks PoseLandmarker in parallel. It runs in WASM
 *   on a background thread — no main-thread blocking, no browser freeze.
 *   Pose loads asynchronously after HandLandmarker is ready, so the camera
 *   is never blocked waiting for it.
 *
 * CAUSE 4 ── Buffer overflow: rolling window capped at 60 frames at 30fps
 *   = only 2 seconds. Training max_frames = 60 at 15fps = 4 seconds.
 *   FIX: Buffer cap = 90 frames at 15fps = 6 seconds (drains every 400ms).
 */

type DetectorStatus = "idle" | "loading" | "ready" | "error";

// Must match training/config.py: target_fps = 15
const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS; // 66.67ms

export function useHandLandmarker(videoRef: React.RefObject<HTMLVideoElement>) {
  const [status, setStatus]             = useState<DetectorStatus>("idle");
  const [error, setError]               = useState<string | null>(null);
  const [handsDetected, setHandsDetected] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const handLandmarkerRef  = useRef<any>(null);
  const poseLandmarkerRef  = useRef<any>(null);
  const poseReadyRef       = useRef(false);
  const rafRef             = useRef<number | null>(null);
  const frameBufferRef     = useRef<LandmarkFrame[]>([]);
  const lastCaptureTimeRef = useRef<number>(0); // FIX 1: 15fps gate
  const latestPoseRef      = useRef<number[][] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setStatus("loading");
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { HandLandmarker, PoseLandmarker, FilesetResolver } = vision;

        const resolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        // ── Hand landmarker (blocking — must be ready before camera starts)
        const handLandmarker = await HandLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });

        if (cancelled) return;
        handLandmarkerRef.current = handLandmarker;
        setStatus("ready"); // camera can start now

        // ── Pose landmarker (non-blocking — loads in background)
        // Uses the lightweight "lite" model to avoid any performance hit.
        PoseLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        })
          .then((pl: any) => {
            if (!cancelled) {
              poseLandmarkerRef.current = pl;
              poseReadyRef.current = true;
            }
          })
          .catch(() => {
            // Pose fails gracefully — hands-only still works, just lower accuracy
            poseReadyRef.current = false;
          });
      } catch (err) {
        if (cancelled) return;
        console.error("HandLandmarker init error:", err);
        setError(err instanceof Error ? err.message : "Failed to load hand detector");
        setStatus("error");
      }
    }

    init();
    return () => {
      cancelled = true;
      handLandmarkerRef.current?.close?.();
      poseLandmarkerRef.current?.close?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const detectFrame = useCallback(() => {
    const video        = videoRef.current;
    const handLandmarker = handLandmarkerRef.current;
    if (!video || !handLandmarker || video.readyState < 2) return;

    const nowMs = performance.now();

    // FIX 1: Only process a frame every 66ms (= 15fps) to match training.
    // rAF fires at ~60fps; we skip 3 out of every 4 frames.
    if (nowMs - lastCaptureTimeRef.current < FRAME_INTERVAL_MS) return;
    lastCaptureTimeRef.current = nowMs;

    // ── Hand detection ──────────────────────────────────────────────────────
    const handResult = handLandmarker.detectForVideo(video, nowMs);

    let left:  number[][] | null = null;
    let right: number[][] | null = null;

    if (handResult.landmarks && handResult.landmarks.length > 0) {
      handResult.landmarks.forEach((landmarks: any[], idx: number) => {
        const coords     = landmarks.map((lm: any) => [lm.x, lm.y, lm.z]);
        const handedness = handResult.handedness?.[idx]?.[0]?.categoryName;

        // FIX 2: SWAP handedness to match MediaPipe Holistic convention.
        // Tasks "Left" on mirrored camera = user's anatomical RIGHT hand.
        // Tasks "Right" on mirrored camera = user's anatomical LEFT hand.
        if (handedness === "Left") {
          right = coords;   // Tasks "Left" → right hand (user's perspective)
        } else if (handedness === "Right") {
          left = coords;    // Tasks "Right" → left hand (user's perspective)
        }
      });
    }

    setHandsDetected({ left: !!left, right: !!right });

    // ── Pose detection (FIX 3) ─────────────────────────────────────────────
    // Run every captured frame (same 15fps rate) so pose aligns with hands.
    if (poseReadyRef.current && poseLandmarkerRef.current) {
      try {
        const poseResult = poseLandmarkerRef.current.detectForVideo(video, nowMs);
        if (poseResult.landmarks && poseResult.landmarks.length > 0) {
          latestPoseRef.current = poseResult.landmarks[0].map((lm: any) => [lm.x, lm.y, lm.z]);
        } else {
          latestPoseRef.current = null;
        }
      } catch {
        // Single frame failure — keep previous pose
      }
    }

    // ── Push frame to buffer ────────────────────────────────────────────────
    frameBufferRef.current.push({
      hand_landmarks_left:  left,
      hand_landmarks_right: right,
      pose_landmarks:       latestPoseRef.current, // now populated!
      face_landmarks:       null,
      timestamp_ms:         Date.now(),
    });

    // FIX 4: Buffer 90 frames at 15fps = 6 seconds headroom
    // Classifier uses last 60 (= training max_frames = 4 seconds)
    if (frameBufferRef.current.length > 90) {
      frameBufferRef.current.shift();
    }
  }, [videoRef]);

  const startLoop = useCallback(() => {
    lastCaptureTimeRef.current = 0;
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
    frameBufferRef.current = [];
    latestPoseRef.current  = null;
  }, []);

  const drainFrameBuffer = useCallback((): LandmarkFrame[] => {
    const frames = [...frameBufferRef.current];
    frameBufferRef.current = [];
    return frames;
  }, []);

  return { status, error, handsDetected, startLoop, stopLoop, drainFrameBuffer };
}
