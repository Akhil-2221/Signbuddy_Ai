"""
pipeline/real_sign_classifier.py
----------------------------------
Production implementation of the SignClassifier interface backed by the
trained BiLSTM model (best_model.pth).

Bug-fixes applied in this version
-----------------------------------
BUG 1 & 2 — Rolling frame buffer was declared but never used.
  classify_sequence was receiving 1-5 webcam frames per call, padding them
  straight to 60 frames, and feeding 90-97% zeros into the BiLSTM.  The
  model was trained on real dense sequences; this zero-padded input was
  completely out-of-distribution, making recognition impossible.
  FIX: _frame_buffer is now the single source of truth.  Every incoming
  frame is appended to the buffer.  Inference only runs once the buffer
  holds at least MIN_FRAMES real frames, and feeds all buffered frames to
  the model (up to WINDOW_SIZE) before any zero-padding is applied.

BUG 3 — Pose normalisation silently failed when hips are off-camera.
  MediaPipe returns (0,0,0) for landmarks outside the camera frame.  When
  the signer's lower body was not visible, hip landmarks 23/24 were zero,
  so mid_hip = (0,0,0) and the translation step did nothing, leaving pose
  features position-dependent at inference time even though training used
  hip-centred poses (hips are visible in a seated/standing training video).
  FIX: Fall back to the nose landmark (index 0, always visible) as the
  normalisation centre when hips are not detected.

BUG 4 — EMA smoother poisoned predictions across different signs.
  With alpha=0.35 and no reset on class change, a strong prediction for
  sign A decayed over ~20 subsequent frames and bled into sign B's output,
  causing persistent misclassification when transitioning between signs.
  FIX: The smoother now detects when the top predicted class changes and
  resets its state immediately so each new sign starts from a clean slate.

BUG 5 — Confidence threshold 0.50 suppressed most valid predictions.
  With 60 classes, a correctly-predicted softmax peak is typically 0.30-0.55.
  A hard threshold of 0.50 silently returned empty text for a large fraction
  of correct recognitions, making the system appear unresponsive.
  FIX: Threshold lowered to 0.25.  The raw confidence value and a
  lowConfidence flag are still returned so the UI can choose how to display
  uncertain results.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
import torch.nn.functional as F

_AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_AI_ROOT))

from pipeline.interfaces import LandmarkFrame, RecognitionResult, SignClassifier
from training.config import cfg
from training.utils import SignBuddyBiLSTM

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_LEFT_HAND_SIZE  = 21 * 3   # 63
_RIGHT_HAND_SIZE = 21 * 3   # 63
_POSE_SIZE       = 33 * 3   # 99
_FEATURE_SIZE    = _LEFT_HAND_SIZE + _RIGHT_HAND_SIZE + _POSE_SIZE  # 225

# Minimum real frames in the buffer before running inference.
# Dataset videos at 15 fps average 1–3 seconds → 15–45 frames.
# Waiting for MIN_FRAMES ensures the model sees a meaningful segment.
MIN_FRAMES: int = 15

# Rolling buffer size — matches training max_frames (60).
WINDOW_SIZE: int = 60

# Consecutive no-hand frames before the buffer and smoother are cleared.
NO_HAND_RESET_THRESHOLD: int = 20

# Lowered from 0.50 → with 60 classes, correct softmax peaks are often 0.30–0.55.
CONFIDENCE_THRESHOLD: float = 0.25


# ---------------------------------------------------------------------------
# Landmark frame → feature vector   (must exactly mirror extract_landmarks.py)
# ---------------------------------------------------------------------------

def _normalise_hand(flat: np.ndarray) -> np.ndarray:
    """
    Translate wrist to origin and scale by wrist→middle-finger-MCP distance.

    Input/output: flat float32 array of length 63.
    """
    pts = flat.reshape(21, 3)
    if np.allclose(pts, 0):
        return flat
    pts = pts - pts[0:1]                    # wrist → origin
    scale = np.linalg.norm(pts[9])          # middle-finger MCP distance
    if scale > 1e-6:
        pts = pts / scale
    return pts.flatten()


def _normalise_pose(flat: np.ndarray) -> np.ndarray:
    """
    Translate pose to a stable centre and scale by shoulder width.

    Centre is mid-hip when hips are visible; falls back to nose (index 0)
    when the lower body is off-camera (hips return as zero from MediaPipe).

    Input/output: flat float32 array of length 99.
    """
    pts = flat.reshape(33, 3)
    if np.allclose(pts, 0):
        return flat

    left_hip  = pts[23]
    right_hip = pts[24]

    # Use mid-hip only when both hip landmarks are actually detected (non-zero)
    if np.linalg.norm(left_hip) > 1e-6 and np.linalg.norm(right_hip) > 1e-6:
        centre = (left_hip + right_hip) / 2.0
    else:
        # Nose (index 0) is always detected — safe fallback
        centre = pts[0]

    pts = pts - centre

    shoulder_dist = np.linalg.norm(pts[11] - pts[12])
    if shoulder_dist > 1e-6:
        pts = pts / shoulder_dist
    return pts.flatten()


def landmark_frame_to_vector(frame: LandmarkFrame) -> np.ndarray:
    """
    Convert one LandmarkFrame into a flat float32 feature vector of size 225.

    Layout matches the training pipeline (extract_landmarks.py / build_feature_vector):
        [0:63]    left hand  — 21 landmarks × 3 coords, wrist-normalised
        [63:126]  right hand — 21 landmarks × 3 coords, wrist-normalised
        [126:225] pose       — 33 landmarks × 3 coords, hip/nose-centred
    """
    # ---- Left hand --------------------------------------------------------
    if frame.hand_landmarks_left is not None:
        arr  = np.array(frame.hand_landmarks_left, dtype=np.float32)
        flat = arr.flatten()[:_LEFT_HAND_SIZE]
        # Pad if fewer than 21 landmarks were supplied
        if len(flat) < _LEFT_HAND_SIZE:
            flat = np.pad(flat, (0, _LEFT_HAND_SIZE - len(flat)))
        left = _normalise_hand(flat)
    else:
        left = np.zeros(_LEFT_HAND_SIZE, dtype=np.float32)

    # ---- Right hand -------------------------------------------------------
    if frame.hand_landmarks_right is not None:
        arr  = np.array(frame.hand_landmarks_right, dtype=np.float32)
        flat = arr.flatten()[:_RIGHT_HAND_SIZE]
        if len(flat) < _RIGHT_HAND_SIZE:
            flat = np.pad(flat, (0, _RIGHT_HAND_SIZE - len(flat)))
        right = _normalise_hand(flat)
    else:
        right = np.zeros(_RIGHT_HAND_SIZE, dtype=np.float32)

    # ---- Pose -------------------------------------------------------------
    if frame.pose_landmarks is not None:
        arr  = np.array(frame.pose_landmarks, dtype=np.float32)
        flat = arr.flatten()
        if len(flat) < _POSE_SIZE:
            flat = np.pad(flat, (0, _POSE_SIZE - len(flat)))
        else:
            flat = flat[:_POSE_SIZE]
        pose = _normalise_pose(flat)
    else:
        pose = np.zeros(_POSE_SIZE, dtype=np.float32)

    return np.concatenate([left, right, pose])   # (225,)


# ---------------------------------------------------------------------------
# Prediction smoother
# ---------------------------------------------------------------------------

class PredictionSmoother:
    """
    EMA smoother over successive probability vectors.

    Resets automatically when the top predicted class changes, preventing
    a previous sign's probability mass from bleeding into the next sign.
    """

    def __init__(self, ema_alpha: float = 0.45) -> None:
        self.ema_alpha    = ema_alpha
        self._ema: Optional[np.ndarray] = None
        self._prev_best:  int = -1

    def update(self, probs: np.ndarray) -> np.ndarray:
        current_best = int(np.argmax(probs))

        # Class flip → hard reset so the new sign starts from scratch
        if self._ema is None or current_best != self._prev_best:
            self._ema = probs.copy()
        else:
            self._ema = self.ema_alpha * probs + (1.0 - self.ema_alpha) * self._ema

        self._prev_best = current_best
        return self._ema

    def reset(self) -> None:
        self._ema      = None
        self._prev_best = -1


# ---------------------------------------------------------------------------
# RealSignClassifier
# ---------------------------------------------------------------------------

class RealSignClassifier(SignClassifier):
    """
    Production sign classifier backed by the trained BiLSTM model.

    Implements the SignClassifier interface (pipeline/interfaces.py).

    Real-time operation
    -------------------
    The classifier maintains a rolling frame buffer (deque, maxlen=WINDOW_SIZE).
    classify_sequence appends every incoming frame to this buffer on each call.
    The API can therefore be called with as few as 1 frame per webcam tick.
    Inference fires once the buffer contains at least MIN_FRAMES real frames,
    at which point the model receives a properly-dense sequence rather than a
    near-zero-padded stub.

    Args:
        model_path           : Path to best_model.pth.
        labels_path          : Path to labels.json.
        device               : Torch device (auto-detected if None).
        confidence_threshold : Min softmax probability to surface a prediction.
        window_size          : Rolling buffer length (frames).  Should match
                               max_frames used during training (default 60).
        min_frames           : Minimum buffer fill before first inference.
        ema_alpha            : EMA smoothing weight (higher = more responsive).
        top_k                : Number of alternative predictions to return.
    """

    def __init__(
        self,
        model_path:           Optional[Path]         = None,
        labels_path:          Optional[Path]         = None,
        device:               Optional[torch.device] = None,
        confidence_threshold: float                  = CONFIDENCE_THRESHOLD,
        window_size:          int                    = WINDOW_SIZE,
        min_frames:           int                    = MIN_FRAMES,
        ema_alpha:            float                  = 0.45,
        top_k:                int                    = 3,
    ) -> None:
        self._model_path  = model_path  or cfg.paths.best_model_path
        self._labels_path = labels_path or cfg.paths.labels_json_path
        self._conf_thresh = confidence_threshold
        self._top_k       = top_k
        self._max_seq_len = cfg.training.max_seq_len   # 60
        self._window_size = window_size
        self._min_frames  = min_frames

        # Device resolution
        if device is not None:
            self._device = device
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            self._device = torch.device("mps")
        else:
            self._device = torch.device("cpu")

        # Rolling buffer — the core fix for BUGs 1 & 2
        self._frame_buffer: deque[np.ndarray] = deque(maxlen=window_size)
        self._smoother     = PredictionSmoother(ema_alpha=ema_alpha)
        self._no_hand_frames: int = 0

        self._labels: list[str] = []
        self._model: Optional[SignBuddyBiLSTM] = None
        self._load()

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Load labels.json and best_model.pth from disk."""
        if not self._labels_path.exists():
            raise FileNotFoundError(
                f"labels.json not found: {self._labels_path}\n"
                "Run the training pipeline first:\n"
                "  python -m training.extract_landmarks\n"
                "  python -m training.prepare_dataset\n"
                "  python -m training.train"
            )
        with open(self._labels_path) as f:
            data = json.load(f)
        self._labels = data["labels"]
        num_classes  = len(self._labels)
        log.info("Loaded %d ISL class labels.", num_classes)

        if not self._model_path.exists():
            raise FileNotFoundError(
                f"best_model.pth not found: {self._model_path}\n"
                "Run training first."
            )
        mc = cfg.model
        mc.num_classes = num_classes
        self._model = SignBuddyBiLSTM(mc)
        state = torch.load(str(self._model_path), map_location=self._device)
        self._model.load_state_dict(state)
        self._model.to(self._device)
        self._model.eval()

        # Warmup — eliminates first-call latency spike (JIT / cuDNN init)
        dummy = torch.zeros(1, self._max_seq_len, _FEATURE_SIZE, device=self._device)
        with torch.no_grad():
            _ = self._model(dummy)

        log.info(
            "RealSignClassifier ready — device=%s | classes=%d | "
            "window=%d | min_frames=%d | threshold=%.2f",
            self._device, num_classes,
            self._window_size, self._min_frames, self._conf_thresh,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _buffer_to_tensor(self) -> torch.Tensor:
        """
        Stack the rolling buffer into a (1, max_seq_len, 225) tensor.

        Real frames are never front-padded; padding is only added after real
        frames to reach max_seq_len, matching dataset.py's pad_or_truncate.
        """
        seq = np.stack(list(self._frame_buffer), axis=0)   # (T, 225)
        T, F = seq.shape

        if T < self._max_seq_len:
            # Post-pad with zeros — same convention as training
            pad = np.zeros((self._max_seq_len - T, F), dtype=np.float32)
            seq = np.concatenate([seq, pad], axis=0)
        elif T > self._max_seq_len:
            # Centre-crop — same as extract_landmarks.py
            start = (T - self._max_seq_len) // 2
            seq   = seq[start : start + self._max_seq_len]

        return torch.from_numpy(seq).unsqueeze(0).to(self._device)   # (1, 60, 225)

    @torch.no_grad()
    def _infer(self) -> np.ndarray:
        """Run the model on the current buffer; return softmax probs (num_classes,)."""
        tensor = self._buffer_to_tensor()
        logits = self._model(tensor)
        return F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

    def _make_result(
        self,
        probs: np.ndarray,
        latency_ms: int,
        suppress: bool = False,
    ) -> RecognitionResult:
        """Build a RecognitionResult from a probability vector."""
        k = min(self._top_k, len(self._labels))
        top_indices = np.argsort(probs)[::-1][:k]

        best_idx  = int(top_indices[0])
        best_conf = float(probs[best_idx])
        # Return empty text when suppressed, but still populate alternatives
        # so the UI can show low-confidence suggestions if it chooses to
        best_text = "" if suppress else self._labels[best_idx]

        alternatives = [
            (self._labels[int(i)], float(probs[int(i)]))
            for i in top_indices[1:]
        ]

        return RecognitionResult(
            text=best_text,
            confidence=round(best_conf, 4),
            latency_ms=latency_ms,
            alternatives=alternatives,
        )

    # ------------------------------------------------------------------
    # Public interface  (implements SignClassifier)
    # ------------------------------------------------------------------

    def classify_sequence(
        self,
        frames: list[LandmarkFrame],
        sign_language: str = "ISL",
    ) -> RecognitionResult:
        """
        Real-time sign classification via rolling frame buffer.

        Each call appends the incoming frames to an internal buffer (deque,
        maxlen=WINDOW_SIZE).  Inference runs once the buffer holds at least
        MIN_FRAMES real frames, giving the BiLSTM a dense, meaningful
        sequence on every forward pass.

        The caller may send any number of frames per call (1 is fine).
        """
        t0 = time.perf_counter()

        if not frames:
            return RecognitionResult(text="", confidence=0.0, latency_ms=0, alternatives=[])

        # Detect hand presence in this batch
        any_hand = any(
            f.hand_landmarks_left is not None or f.hand_landmarks_right is not None
            for f in frames
        )

        # Always buffer every incoming frame — even no-hand frames carry pose
        for f in frames:
            self._frame_buffer.append(landmark_frame_to_vector(f))

        # No-hand handling
        if not any_hand:
            self._no_hand_frames += 1
            if self._no_hand_frames >= NO_HAND_RESET_THRESHOLD:
                # Clear buffer and smoother; signer has left the frame
                self._frame_buffer.clear()
                self._smoother.reset()
                self._no_hand_frames = 0
            latency_ms = int((time.perf_counter() - t0) * 1000)
            return RecognitionResult(text="", confidence=0.0,
                                     latency_ms=latency_ms, alternatives=[])

        self._no_hand_frames = 0

        # Don't run inference until the buffer is warm
        if len(self._frame_buffer) < self._min_frames:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            return RecognitionResult(text="", confidence=0.0,
                                     latency_ms=latency_ms, alternatives=[])

        # Model forward pass
        raw_probs    = self._infer()
        smooth_probs = self._smoother.update(raw_probs)

        latency_ms = int((time.perf_counter() - t0) * 1000)
        best_conf  = float(smooth_probs.max())
        suppress   = best_conf < self._conf_thresh

        return self._make_result(smooth_probs, latency_ms, suppress=suppress)

    def reset_buffer(self) -> None:
        """
        Explicitly clear the frame buffer and prediction smoother.

        Call this after a word is accepted (e.g. space pressed) so the next
        sign starts without any carry-over from the previous one.
        """
        self._frame_buffer.clear()
        self._smoother.reset()
        self._no_hand_frames = 0
        log.debug("Frame buffer and smoother reset.")

    def score_single_sign(
        self,
        frames: list[LandmarkFrame],
        target_gloss: str,
        sign_language: str = "ISL",
    ) -> dict[str, Any]:
        """
        AI Tutor: score a deliberate practice clip against a target gloss.

        Unlike classify_sequence, this treats the supplied frames as a
        self-contained clip (does NOT use the rolling buffer) — appropriate
        for a "record and evaluate" interaction mode.
        """
        if not frames:
            return {"predicted_gloss": "", "confidence": 0.0,
                    "is_correct": False, "target_rank": -1, "target_prob": 0.0}

        vectors = [landmark_frame_to_vector(f) for f in frames]
        seq     = np.stack(vectors, axis=0).astype(np.float32)
        T, F    = seq.shape

        if T < self._max_seq_len:
            pad = np.zeros((self._max_seq_len - T, F), dtype=np.float32)
            seq = np.concatenate([seq, pad], axis=0)
        else:
            start = (T - self._max_seq_len) // 2
            seq   = seq[start : start + self._max_seq_len]

        tensor = torch.from_numpy(seq).unsqueeze(0).to(self._device)
        with torch.no_grad():
            logits = self._model(tensor)
            probs  = F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

        top_idx   = int(np.argmax(probs))
        predicted = self._labels[top_idx]
        best_conf = float(probs[top_idx])

        target_norm = target_gloss.upper().strip()
        target_idx  = next(
            (i for i, lbl in enumerate(self._labels) if lbl.upper() == target_norm),
            None,
        )
        if target_idx is not None:
            target_prob = float(probs[target_idx])
            target_rank = np.argsort(probs)[::-1].tolist().index(target_idx) + 1
        else:
            target_prob = 0.0
            target_rank = -1
            log.warning("target_gloss '%s' not in labels.", target_gloss)

        return {
            "predicted_gloss": predicted,
            "confidence":      round(best_conf, 4),
            "is_correct":      predicted.upper() == target_norm,
            "target_rank":     target_rank,
            "target_prob":     round(target_prob, 4),
        }

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def labels(self) -> list[str]:
        return self._labels

    @property
    def num_classes(self) -> int:
        return len(self._labels)

    @property
    def device(self) -> torch.device:
        return self._device
