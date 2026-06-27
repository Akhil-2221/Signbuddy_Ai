"""
# MOCK — NOT a trained model.

This stands in for a real sign-recognition model so the rest of the stack
(backend, frontend, database, WebSocket streaming) can be built and tested
end-to-end honestly. It does NOT recognize real sign language.

Behavior: returns a plausible-looking response with randomized confidence,
occasionally a deliberately low-confidence result to exercise the
low-confidence fallback UI path. Swap for a real implementation of
SignClassifier (see interfaces.py) once a model is trained per
training/README.md.
"""

from __future__ import annotations

import random
import time

from pipeline.interfaces import LandmarkFrame, RecognitionResult, SignClassifier

# A tiny demo vocabulary so responses are at least thematically plausible
# during integration testing — matches the seeded sign_dictionary entries.
_DEMO_VOCAB = ["HELLO", "THANK YOU", "HELP", "EMERGENCY", "DOCTOR", "YES", "NO", "PLEASE"]


class MockSignClassifier(SignClassifier):
    def classify_sequence(
        self, frames: list[LandmarkFrame], sign_language: str
    ) -> RecognitionResult:
        start = time.monotonic()

        # Simulate using the frame count as if it mattered, so latency scales
        # plausibly with input size (a real model's latency would too).
        simulated_processing_s = min(0.05 + 0.002 * len(frames), 0.4)
        time.sleep(simulated_processing_s)

        text = "HELLO"
        confidence = 0.95
        confidence = round(random.uniform(0.45, 0.97), 3)

        latency_ms = int((time.monotonic() - start) * 1000)

        alternatives = [
            (w, round(random.uniform(0.1, confidence - 0.05), 3))
            for w in random.sample([v for v in _DEMO_VOCAB if v != text], k=2)
        ]

        return RecognitionResult(
            text=text,
            confidence=confidence,
            latency_ms=latency_ms,
            alternatives=alternatives,
        )

    def score_single_sign(
        self, frames: list[LandmarkFrame], target_gloss: str, sign_language: str
    ) -> dict:
        confidence = round(random.uniform(0.4, 0.98), 3)
        is_correct = confidence > 0.65
        return {
            "predicted_gloss": target_gloss if is_correct else random.choice(_DEMO_VOCAB),
            "confidence": confidence,
            "is_correct": is_correct,
        }
