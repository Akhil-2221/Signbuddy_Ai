from __future__ import annotations

import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from pipeline.interfaces import LandmarkFrame
from pipeline.real_sign_classifier import RealSignClassifier
from pipeline.speech_pipeline import transcribe_audio, translate_text

app = FastAPI(
    title="SignBuddy AI Service",
    description="MediaPipe landmark extraction + sign recognition interface. "
    "See README.md for what's real vs. mocked.",
    version="1.0.0",
)

# Swap this single line for a real trained classifier once available.
classifier = RealSignClassifier()


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Sign recognition
# ---------------------------------------------------------------------

class LandmarkFramePayload(BaseModel):
    hand_landmarks_left: list[list[float]] | None = None
    hand_landmarks_right: list[list[float]] | None = None
    pose_landmarks: list[list[float]] | None = None
    face_landmarks: list[list[float]] | None = None
    timestamp_ms: int = 0


class RecognizeRequest(BaseModel):
    frames: list[LandmarkFramePayload]
    signLanguage: str
    sessionId: str


class RecognizeResponse(BaseModel):
    text: str
    confidence: float
    lowConfidence: bool
    latencyMs: int
    alternatives: list[dict] | None = None


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
        lowConfidence=result.confidence < 0.6,
        latencyMs=result.latency_ms,
        alternatives=[{"text": t, "confidence": c} for t, c in (result.alternatives or [])],
    )


# ---------------------------------------------------------------------
# Speech-to-text
# ---------------------------------------------------------------------

class TranscribeRequest(BaseModel):
    audioBase64: str
    languageHint: str = "en"


@app.post("/v1/speech/transcribe")
def transcribe(req: TranscribeRequest):
    start = time.monotonic()
    result = transcribe_audio(req.audioBase64, req.languageHint)
    if "latency_ms" not in result:
        result["latency_ms"] = int((time.monotonic() - start) * 1000)
    return {
        "text": result["text"],
        "confidence": result.get("confidence", 0.9),
        "latencyMs": result["latency_ms"],
    }


# ---------------------------------------------------------------------
# Text translation
# ---------------------------------------------------------------------

class TranslateRequest(BaseModel):
    text: str
    sourceLang: str
    targetLang: str


@app.post("/v1/translate/text")
def translate(req: TranslateRequest):
    result = translate_text(req.text, req.sourceLang, req.targetLang)
    return {"translatedText": result["translated_text"]}


# ---------------------------------------------------------------------
# AI Tutor scoring
# ---------------------------------------------------------------------

class TutorScoreRequest(BaseModel):
    frames: list[LandmarkFramePayload]
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
    result = classifier.score_single_sign(domain_frames, req.targetSignId, req.signLanguage)
    return {
        "predictedGloss": result["predicted_gloss"],
        "confidence": result["confidence"],
        "isCorrect": result["is_correct"],
    }
