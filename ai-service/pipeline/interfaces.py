"""
Defines the contract every sign-classification model must implement.

This is the single seam between "the rest of SignBuddy" and "a trained model."
Anyone training a real model (per training/README.md) implements SignClassifier
and wires it in at app/main.py — nothing else in the system needs to change.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class LandmarkFrame:
    """A single frame of extracted keypoints, as produced by landmark_extractor.py."""
    hand_landmarks_left: list[list[float]] | None   # 21 x (x,y,z), normalized
    hand_landmarks_right: list[list[float]] | None  # 21 x (x,y,z), normalized
    pose_landmarks: list[list[float]] | None         # 33 x (x,y,z)
    face_landmarks: list[list[float]] | None          # subset of 468 face mesh points (eyebrow/mouth region for grammar)
    timestamp_ms: int


@dataclass
class RecognitionResult:
    text: str
    confidence: float       # 0.0 - 1.0
    latency_ms: int
    alternatives: list[tuple[str, float]] | None = None  # top-k alternates, for ambiguous-sign UI


class SignClassifier(ABC):
    """Implement this with a real trained model (CNN+LSTM / Transformer per the research)."""

    @abstractmethod
    def classify_sequence(
        self, frames: list[LandmarkFrame], sign_language: str
    ) -> RecognitionResult:
        """Given a sequence of landmark frames, return the recognized text."""
        raise NotImplementedError

    @abstractmethod
    def score_single_sign(
        self, frames: list[LandmarkFrame], target_gloss: str, sign_language: str
    ) -> dict[str, Any]:
        """Used by the AI Tutor: compare a practice attempt against a target sign."""
        raise NotImplementedError
