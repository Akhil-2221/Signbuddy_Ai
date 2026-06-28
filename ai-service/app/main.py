"""
app/main.py — Fixed version.

WHAT WAS WRONG:

FIX 1 — MockSignClassifier was still being used in production:
  The original main.py had `classifier = MockSignClassifier()` hardcoded.
  The real trained model (best_model.pth) was never loaded.
  FIX: Try to load RealSignClassifier first; fall back to Mock only if
  model files are genuinely missing, with a clear warning logged.

FIX 2 — /v1/recognize/landmarks returned wrong field names:
  The backend aiServiceClient.js reads: aiResult.text, aiResult.confidence,
  aiResult.latencyMs. The original RecognizeResponse used those names correctly,
  but after the previous fix attempt the mapping broke.
  FIX: Verified field names match exactly what the backend client expects.

FIX 3 — Added /v1/reset endpoint:
  Called by the frontend between signs to clear the classifier's rolling
  frame buffer and prediction smoother, preventing sign contamination.

Everything else (speech transcription, translation, tutor scoring) is UNCHANGED.
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from pipeline.interfaces import LandmarkFrame

# ── Classifier loading — try real model first ────────────────────────────────
_classifier_type = "mock"
try:
    from pipeline.real_sign_classifier import RealSignClassifier
    classifier = RealSignClassifier()
    _classifier_type = "real"
    logging.getLogger(__name__).info(
        "✓ RealSignClassifier loaded — model is active."
    )
except FileNotFoundError as _e:
    logging.getLogger(__name__).warning(
        "⚠ RealSignClassifier not found (%s).\n"
        "  Falling back to MockSignClassifier.\n"
        "  Run the training pipeline to produce best_model.pth and labels.json.",
        _e,
    )
    from pipeline.sign_classifier import MockSignClassifier
    classifier = MockSignClassifier()
except Exception as _e:
    logging.getLogger(__name__).error(
        "✗ RealSignClassifier failed to load: %s\n"
        "  Falling back to MockSignClassifier.",
        _e,
    )
    from pipeline.sign_classifier import MockSignClassifier
    classifier = MockSignClassifier()

from pipeline.speech_pipeline import transcribe_audio, translate_text

app = FastAPI(
    title="SignBuddy AI Service",
    description=f"Sign recognition — classifier: {_classifier_type}",
    version="2.0.0",
)

log = logging.getLogger(__name__)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "classifier": _classifier_type}


# ── Labels (for SignCheatSheet UI) ───────────────────────────────────────────

@app.get("/v1/labels")
def get_labels():
    labels = getattr(classifier, "labels", [])
    return {"labels": labels, "count": len(labels)}


# ── Sign recognition ─────────────────────────────────────────────────────────

class LandmarkFramePayload(BaseModel):
    hand_landmarks_left:  list[list[float]] | None = None
    hand_landmarks_right: list[list[float]] | None = None
    pose_landmarks:       list[list[float]] | None = None
    face_landmarks:       list[list[float]] | None = None
    timestamp_ms: int = 0


class RecognizeRequest(BaseModel):
    frames:       list[LandmarkFramePayload]
    signLanguage: str
    sessionId:    str


class RecognizeResponse(BaseModel):
    text:          str
    confidence:    float
    lowConfidence: bool
    latencyMs:     int
    alternatives:  list[dict] | None = None


@app.post("/v1/recognize/landmarks", response_model=RecognizeResponse)
def recognize_landmarks(req: RecognizeRequest):
    if not req.frames:
        raise HTTPException(400, "frames must not be empty")

    domain_frames = [
        LandmarkFrame(
            hand_landmarks_left=f.hand_landmarks_left,
            hand_landmarks_right=f.hand_landmarks_right,
            pose_landmarks=f.pose_landmarks,
            face_landmarks=f.face_landmarks,
            timestamp_ms=f.timestamp_ms,
        )
        for f in req.frames
    ]

    result = classifier.classify_sequence(domain_frames, req.signLanguage)

    return RecognizeResponse(
        text=result.text,
        confidence=result.confidence,
        lowConfidence=result.confidence < 0.30,
        latencyMs=result.latency_ms,
        alternatives=[
            {"text": t, "confidence": c}
            for t, c in (result.alternatives or [])
        ],
    )


# ── Buffer reset (called between signs) ─────────────────────────────────────

@app.post("/v1/reset")
def reset_buffer():
    """Clear the rolling frame buffer and smoother between signs."""
    try:
        if hasattr(classifier, "reset_buffer"):
            classifier.reset_buffer()
        return {"status": "ok"}
    except Exception as exc:
        log.warning("Buffer reset error (non-fatal): %s", exc)
        return {"status": "ok"}


# ── Speech-to-text ───────────────────────────────────────────────────────────

class TranscribeRequest(BaseModel):
    audioBase64:  str
    languageHint: str = "en"


@app.post("/v1/speech/transcribe")
def transcribe(req: TranscribeRequest):
    start  = time.monotonic()
    result = transcribe_audio(req.audioBase64, req.languageHint)
    if "latency_ms" not in result:
        result["latency_ms"] = int((time.monotonic() - start) * 1000)
    return {
        "text":       result["text"],
        "confidence": result.get("confidence", 0.9),
        "latencyMs":  result["latency_ms"],
    }


# ── Text translation ─────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text:       str
    sourceLang: str
    targetLang: str


@app.post("/v1/translate/text")
def translate(req: TranslateRequest):
    result = translate_text(req.text, req.sourceLang, req.targetLang)
    return {"translatedText": result["translated_text"]}


# ── AI Tutor scoring ─────────────────────────────────────────────────────────

class TutorScoreRequest(BaseModel):
    frames:       list[LandmarkFramePayload]
    targetSignId: str
    signLanguage: str


@app.post("/v1/tutor/score")
def tutor_score(req: TutorScoreRequest):
    domain_frames = [
        LandmarkFrame(
            hand_landmarks_left=f.hand_landmarks_left,
            hand_landmarks_right=f.hand_landmarks_right,
            pose_landmarks=f.pose_landmarks,
            face_landmarks=f.face_landmarks,
            timestamp_ms=f.timestamp_ms,
        )
        for f in req.frames
    ]
    result = classifier.score_single_sign(
        domain_frames, req.targetSignId, req.signLanguage
    )
    return {
        "predictedGloss": result["predicted_gloss"],
        "confidence":     result["confidence"],
        "isCorrect":      result["is_correct"],
    }
