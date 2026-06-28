"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandmarkFrame } from "@/types";

/**
 * useHandLandmarker — Surgical fix. Original architecture preserved.
 *
 * WHAT WAS WRONG AND WHY:
 *
 * FIX 1 — Handedness swap (caused HELLO→Crocodile wrong predictions):
 *   The original code assigned Tasks API "Left" → left hand, "Right" → right hand.
 *   But the camera feed is mirror-flipped (-scale-x-100 in CameraView).
 *   MediaPipe Tasks API reports handedness from the CAMERA perspective, not the
 *   user's anatomical perspective. On a mirrored selfie camera:
 *     Tasks "Left"  = what appears on the LEFT of the screen = user's RIGHT hand
 *     Tasks "Right" = what appears on the RIGHT of the screen = user's LEFT hand
 *   But during training, MediaPipe Holistic was used, which always returns
 *   left_hand_landmarks = user's anatomical LEFT hand (camera-perspective-corrected).
 *   Result: every frame sent left/right swapped vs. training. Model always wrong.
 *   FIX: Swap the assignment. Tasks "Left" → hand_landmarks_RIGHT, vice versa.
 *
 * FIX 2 — Pose landmarks always null (44% of feature vector was always zero):
 *   Training feature vector = 225 dims: left(63) + right(63) + pose(99).
 *   Original hook sent pose_landmarks: null every frame.
 *   At inference, 99/225 = 44% of every feature vector was zeros — a
 *   distribution the model had never seen during training.
 *   FIX: Add a PoseLandmarker (Tasks API, lightweight) running in parallel.
 *   It runs on the same video element, same timestamp. No Holistic needed.
 *   No browser freeze — both Tasks models run via WASM on a background thread.
 *
 * FIX 3 — Why NOT MediaPipe Holistic:
 *   Holistic runs face+pose+hands simultaneously on the MAIN JS thread.
 *   It causes the "Page Unresponsive" freeze seen in the screenshot.
 *   Tasks API models run in WASM workers → smooth, no freeze.
 *
 * Everything else (camera loop, buffer, drainFrameBuffer) is UNCHANGED.
 */

type DetectorStatus = "idle" | "loading" | "ready" | "error";

// Pose landmark indices for upper body only (matching training normalisation)
// We only need the 33 landmarks MediaPipe provides; Tasks PoseLandmarker gives all 33.

export function useHandLandmarker(videoRef: React.RefObject<HTMLVideoElement>) {
  const [status, setStatus] = useState<DetectorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [handsDetected, setHandsDetected] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const handLandmarkerRef = useRef<any>(null);
  const poseLandmarkerRef = useRef<any>(null);
  const rafRef            = useRef<number | null>(null);
  const frameBufferRef    = useRef<LandmarkFrame[]>([]);

  // Store latest pose result between rAF ticks so we always have a value
  // even if pose runs slightly behind hand detection
  const latestPoseRef = useRef<number[][] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setStatus("loading");
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { HandLandmarker, PoseLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        // Hand detector — same as original
        const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });

        // Pose detector — lightweight, adds the 99 pose features the model needs
        const poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        if (cancelled) return;
        handLandmarkerRef.current = handLandmarker;
        poseLandmarkerRef.current = poseLandmarker;
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("Landmarker init failed:", err);
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
    const poseLandmarker = poseLandmarkerRef.current;
    if (!video || !handLandmarker || video.readyState < 2) return;

    const nowMs = performance.now();

    // ── Hand detection ──────────────────────────────────────────────────────
    const handResult = handLandmarker.detectForVideo(video, nowMs);

    // FIX 1: Swap handedness assignment to match training (Holistic) convention.
    // Tasks API on mirrored camera: "Left" label = user's RIGHT hand.
    let left:  number[][] | null = null;
    let right: number[][] | null = null;

    if (handResult.landmarks && handResult.landmarks.length > 0) {
      handResult.landmarks.forEach((handLandmarks: any[], idx: number) => {
        const coords = handLandmarks.map((lm: any) => [lm.x, lm.y, lm.z]);
        const handedness = handResult.handedness?.[idx]?.[0]?.categoryName;

        // SWAPPED intentionally — see FIX 1 comment above
        if (handedness === "Left") {
          right = coords;   // Tasks "Left" on mirrored camera = user's RIGHT
        } else if (handedness === "Right") {
          left = coords;    // Tasks "Right" on mirrored camera = user's LEFT
        }
      });
    }

    setHandsDetected({ left: !!left, right: !!right });

    // ── Pose detection ──────────────────────────────────────────────────────
    // FIX 2: Run PoseLandmarker to populate the 99 pose features.
    // Only run if poseLandmarker is ready (it may finish loading slightly later).
    if (poseLandmarker) {
      try {
        const poseResult = poseLandmarker.detectForVideo(video, nowMs);
        if (poseResult.landmarks && poseResult.landmarks.length > 0) {
          // 33 landmarks, each with x, y, z
          latestPoseRef.current = poseResult.landmarks[0].map((lm: any) => [lm.x, lm.y, lm.z]);
        } else {
          latestPoseRef.current = null;
        }
      } catch {
        // Pose detection can occasionally throw on first few frames — ignore
        latestPoseRef.current = null;
      }
    }

    // ── Build frame and push to buffer ──────────────────────────────────────
    frameBufferRef.current.push({
      hand_landmarks_left:  left,
      hand_landmarks_right: right,
      pose_landmarks:       latestPoseRef.current,   // now populated!
      face_landmarks:       null,
      timestamp_ms:         Date.now(),
    });

    // Rolling buffer: last ~90 frames (~3 s at 30 fps)
    // Larger than before so the classifier always has enough frames
    if (frameBufferRef.current.length > 90) {
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
