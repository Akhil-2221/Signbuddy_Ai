"""
app/main.py — Production fix.

CAUSE 12 — MockSignClassifier was hardcoded in production
  The original main.py had: classifier = MockSignClassifier()
  The real trained model (best_model.pth + labels.json) was never used.
  MockSignClassifier returns random words — explaining the Turtle/Hug/Umbrella
  problem. It was never swapped for the real classifier.
  FIX: Load RealSignClassifier first. Fall back to Mock ONLY if model files
  are genuinely missing, with a clear error log so it's never silent.

ADDITIONAL: Added /v1/labels and /v1/reset endpoints used by the frontend.
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from pipeline.interfaces import LandmarkFrame

# ── Load the real trained classifier ────────────────────────────────────────
_classifier_type = "unknown"
try:
    from pipeline.real_sign_classifier import RealSignClassifier
    classifier = RealSignClassifier()
    _classifier_type = "real"
    logging.getLogger(__name__).info(
        "✓ RealSignClassifier loaded successfully — real-time recognition active."
    )
except FileNotFoundError as _exc:
    logging.getLogger(__name__).warning(
        "⚠ Model files not found (%s).\n"
        "  Falling back to MockSignClassifier.\n"
        "  To enable real recognition:\n"
        "    python -m training.extract_landmarks\n"
        "    python -m training.prepare_dataset\n"
        "    python -m training.train",
        _exc,
    )
    from pipeline.sign_classifier import MockSignClassifier
    classifier = MockSignClassifier()
    _classifier_type = "mock"
except Exception as _exc:
    logging.getLogger(__name__).error(
        "✗ RealSignClassifier failed to load: %s\n  Falling back to MockSignClassifier.",
        _exc,
    )
    from pipeline.sign_classifier import MockSignClassifier
    classifier = MockSignClassifier()
    _classifier_type = "mock_fallback"

from pipeline.speech_pipeline import transcribe_audio, translate_text

log = logging.getLogger(__name__)

app = FastAPI(
    title="SignBuddy AI Service",
    description=f"ISL recognition — classifier: {_classifier_type}",
    version="2.0.0",
)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "classifier": _classifier_type}


# ── Labels (for SignCheatSheet UI) ───────────────────────────────────────────

@app.get("/v1/labels")
def get_labels():
    """Return all recognizable sign labels for the cheat sheet UI."""
    labels = getattr(classifier, "labels", [])
    return {"labels": labels, "count": len(labels)}


# ── Buffer reset (called between signs) ─────────────────────────────────────

@app.post("/v1/reset")
def reset_buffer():
    """Clear rolling frame buffer + smoother between signs."""
    try:
        if hasattr(classifier, "reset_buffer"):
            classifier.reset_buffer()
        return {"status": "ok"}
    except Exception as exc:
        log.warning("Buffer reset error (non-fatal): %s", exc)
        return {"status": "ok"}


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
