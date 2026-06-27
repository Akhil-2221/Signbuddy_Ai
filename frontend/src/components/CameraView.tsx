"use client";

import { useEffect } from "react";
import { Video, VideoOff, Hand } from "lucide-react";
import { clsx } from "clsx";
import { useCamera } from "@/hooks/useCamera";
import { useHandLandmarker } from "@/hooks/useHandLandmarker";
import { BigButton } from "@/components/BigButton";

interface CameraViewProps {
  active: boolean;
  onToggle: (active: boolean) => void;
  onFramesReady?: (drain: () => any[]) => void;
}

/**
 * Combines real camera access + real MediaPipe hand detection.
 * The green "hand detected" pulse and dot overlay reflect genuine live
 * detection state — not a simulated indicator.
 */
export function CameraView({ active, onToggle, onFramesReady }: CameraViewProps) {
  const { videoRef, isActive, error, start, stop } = useCamera();
  const { status, handsDetected, startLoop, stopLoop, drainFrameBuffer } = useHandLandmarker(videoRef);

  useEffect(() => {
    if (active && !isActive) start();
    if (!active && isActive) stop();
  }, [active, isActive, start, stop]);

  useEffect(() => {
    if (isActive && status === "ready") {
      startLoop();
      onFramesReady?.(drainFrameBuffer);
    }
    return () => stopLoop();
  }, [isActive, status, startLoop, stopLoop, drainFrameBuffer, onFramesReady]);

  const anyHandDetected = handsDetected.left || handsDetected.right;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink-900 aspect-[4/5] sm:aspect-video">
      <video
        ref={videoRef}
        playsInline
        muted
        className={clsx("h-full w-full object-cover -scale-x-100 transition-opacity", isActive ? "opacity-100" : "opacity-0")}
      />

      {!isActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <VideoOff size={40} className="text-signal-100" />
          <p className="text-white/90">
            {error ? error : "Camera is off. Start it when you're ready to sign."}
          </p>
          <BigButton icon={<Video size={20} />} onClick={() => onToggle(true)}>
            Start Camera
          </BigButton>
        </div>
      )}

      {isActive && (
        <>
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
            <span
              className={clsx(
                "h-2.5 w-2.5 rounded-full",
                anyHandDetected ? "bg-emerald-400 animate-pulse" : "bg-white/40"
              )}
            />
            <span className="text-xs font-medium text-white">
              {status === "loading"
                ? "Loading detector…"
                : anyHandDetected
                ? "Hands detected"
                : "Show your hands to the camera"}
            </span>
            <Hand size={14} className="text-white/80" />
          </div>

          <button
            onClick={() => onToggle(false)}
            className="absolute right-4 top-4 rounded-full bg-black/40 p-2.5 text-white backdrop-blur"
            aria-label="Stop camera"
          >
            <VideoOff size={18} />
          </button>
        </>
      )}
    </div>
  );
}
