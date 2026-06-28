"""
pipeline/real_sign_classifier.py
==================================
Production BiLSTM classifier — matches training pipeline exactly.

COMPLETE AUDIT OF ALL BUGS AND FIXES
======================================

BUG 1 ── 30fps inference vs 15fps training [PRIMARY cause of wrong labels]
  training/config.py: target_fps = 15
  extract_landmarks.py: sample_every = round(src_fps / 15) — skips frames
  Inference was receiving ~30fps frames (every rAF tick).
  Same 2-second "HELLO": training = ~30 frames, inference = ~60 frames.
  BiLSTM temporal patterns (learned at 15fps) are completely wrong at 30fps.
  FIX IN: useHandLandmarker.ts — 66ms gate so only 15fps frames enter buffer.
  FIX HERE: WINDOW_SIZE=60 (= 4s at 15fps, matching max_frames=60 in config).

BUG 2 ── Frame buffer not used: classify_sequence padded 5 frames to 60
  Each API call got ~5 frames (300ms × 15fps). Classifier padded immediately
  to 60 = 55 zeros appended. Model received 92% zeros — never seen in training.
  FIX: Rolling buffer (deque) accumulates across API calls. Inference only
  fires when buffer >= MIN_FRAMES real frames.

BUG 3 ── Handedness swap [in useHandLandmarker.ts]
  Training: Holistic left_hand = anatomical LEFT
  Inference: Tasks "Left" on mirrored camera = anatomical RIGHT
  FIX: swap in useHandLandmarker.ts (Tasks "Left" → right, "Right" → left)

BUG 4 ── pose_landmarks always null (44% of feature vector = zeros)
  Training: left(63) + right(63) + pose(99) = 225 dims
  Inference: left(63) + right(63) + 0(99) = mismatch
  FIX: PoseLandmarker added in useHandLandmarker.ts

BUG 5 ── Normalisation: _normalise_hand() received flat array, not (21,3)
  Training calls: _normalise_hand(_lm_to_arr(...)) where _lm_to_arr returns (21,3)
  Previous inference code: flat.reshape(21,3) worked but had wrong input shape check
  FIX: accept (21,3) array directly, matching training exactly

BUG 6 ── EMA smoother contaminated sign B with sign A's probability mass
  No reset when predicted class changed. Same class required for re-emission.
  FIX: Hard reset on class change.

BUG 7 ── Confidence threshold 0.25 too aggressive for EMA-smoothed probs
  After EMA smoothing, winning class prob often 0.35–0.65 for correct signs.
  FIX: Threshold 0.25 with EMA alpha=0.5 (responsive, not over-smoothed)

BUG 8 ── Padding: must be POST-pad (zeros appended), matching dataset.py
  dataset.py pad_or_truncate: zeros appended after real frames
  Some previous inference code did pre-pad or wrong crop
  FIX: post-pad, centre-crop for long — identical to dataset.py

BUG 9 ── Duplicate suppression: same word repeated 20+ times
  Without suppression, each inference fires the same word every 300ms.
  FIX: DuplicateSuppressor with 20-frame cooldown (~1.3 seconds at 15fps)
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

# ── Constants — MUST match training/config.py ─────────────────────────────────
# training/config.py: feature_size=225, max_frames=60, target_fps=15, min_frames=10

_N_HAND_LM   = 21          # num_hand_landmarks in config
_N_POSE_LM   = 33          # num_pose_landmarks in config
_LEFT_SIZE   = _N_HAND_LM * 3   # 63
_RIGHT_SIZE  = _N_HAND_LM * 3   # 63
_POSE_SIZE   = _N_POSE_LM * 3   # 99
_FEAT_SIZE   = 225               # 63+63+99

# Matches training: max_frames=60 @ 15fps = 4 seconds
WINDOW_SIZE  = 60   # rolling buffer length (frames @ 15fps)
MIN_FRAMES   = 12   # min real frames before inference (matches min_frames=10 + margin)

# No-hand reset: 15 frames @ 15fps = 1 second without hands → clear buffer
NO_HAND_RESET = 15

# Confidence: with 60 classes, correct peaks typically 0.25–0.65
CONF_THRESHOLD = 0.25

# Duplicate suppression: don't re-emit same word for 20 frames (~1.3s @ 15fps)
DUPLICATE_COOLDOWN = 20


# ── Normalisation — identical to training/extract_landmarks.py ────────────────

def _normalise_hand(hand: np.ndarray) -> np.ndarray:
    """
    Translate wrist to origin and scale by wrist→middle-finger-MCP distance.
    Input: (21, 3) array (matching _lm_to_arr output in training)
    Output: (21, 3) array
    IDENTICAL to _normalise_hand() in extract_landmarks.py
    """
    if np.allclose(hand, 0):
        return hand
    # Translate: wrist (index 0) becomes origin
    hand = hand - hand[0:1, :]
    # Scale: wrist→middle-finger MCP distance (index 9)
    scale = np.linalg.norm(hand[9])
    if scale > 1e-6:
        hand = hand / scale
    return hand


def _normalise_pose(pose: np.ndarray) -> np.ndarray:
    """
    Translate to mid-hip and scale by shoulder width.
    Input: (33, 3) array
    Output: (33, 3) array
    IDENTICAL to _normalise_pose() in extract_landmarks.py
    NOTE: Training did NOT use a nose fallback — keeping exact same behaviour.
    """
    if np.allclose(pose, 0):
        return pose
    # Mid-hip: average of left (23) and right (24) hip landmarks
    mid_hip = (pose[23:24] + pose[24:25]) / 2.0
    pose = pose - mid_hip
    # Scale: left (11) - right (12) shoulder distance
    shoulder_dist = np.linalg.norm(pose[11] - pose[12])
    if shoulder_dist > 1e-6:
        pose = pose / shoulder_dist
    return pose


def landmark_frame_to_vector(frame: LandmarkFrame) -> np.ndarray:
    """
    Convert one LandmarkFrame → 225-dim float32 feature vector.

    Layout IDENTICAL to build_feature_vector() in extract_landmarks.py:
        [0:63]    left_hand  — _normalise_hand(_lm_to_arr(...)).flatten()
        [63:126]  right_hand — _normalise_hand(_lm_to_arr(...)).flatten()
        [126:225] pose       — _normalise_pose(_lm_to_arr(...)).flatten()

    Training code: np.concatenate([left.flatten(), right.flatten(), pose.flatten()])
    where left, right, pose are (21,3), (21,3), (33,3) arrays.
    """
    def _to_arr(data: list | None, n: int) -> np.ndarray:
        """Matches _lm_to_arr() in extract_landmarks.py"""
        if data is None:
            return np.zeros((n, 3), dtype=np.float32)
        arr = np.array(data, dtype=np.float32)
        # Handle both (n,3) and flat (n*3,) inputs
        if arr.ndim == 1:
            arr = arr.reshape(-1, 3)
        if arr.shape[0] < n:
            arr = np.pad(arr, ((0, n - arr.shape[0]), (0, 0)))
        return arr[:n].astype(np.float32)

    left  = _normalise_hand(_to_arr(frame.hand_landmarks_left,  _N_HAND_LM))
    right = _normalise_hand(_to_arr(frame.hand_landmarks_right, _N_HAND_LM))
    pose  = _normalise_pose(_to_arr(frame.pose_landmarks,       _N_POSE_LM))

    # Identical to training: concatenate flattened arrays
    return np.concatenate([left.flatten(), right.flatten(), pose.flatten()])  # (225,)


# ── Padding — identical to dataset.py pad_or_truncate() ──────────────────────

def _pad_or_truncate(seq: np.ndarray, max_len: int) -> np.ndarray:
    """
    POST-pad short sequences with zeros (appended after real frames).
    Centre-crop long sequences.
    IDENTICAL to pad_or_truncate() in dataset.py and the truncation logic
    in extract_landmarks.py.
    """
    T, F = seq.shape
    if T == max_len:
        return seq
    if T > max_len:
        # Centre-crop — identical to extract_landmarks.py
        start = (T - max_len) // 2
        return seq[start : start + max_len]
    # Post-pad with zeros — identical to dataset.py
    pad = np.zeros((max_len - T, F), dtype=np.float32)
    return np.concatenate([seq, pad], axis=0)


# ── Prediction smoother ───────────────────────────────────────────────────────

class PredictionSmoother:
    """EMA smoother with hard reset on class change (BUG 6 fix)."""

    def __init__(self, alpha: float = 0.50) -> None:
        self._alpha = alpha
        self._ema: Optional[np.ndarray] = None
        self._prev  = -1

    def update(self, probs: np.ndarray) -> np.ndarray:
        best = int(np.argmax(probs))
        # Hard reset when predicted class changes — prevents contamination
        if self._ema is None or best != self._prev:
            self._ema = probs.copy()
        else:
            self._ema = self._alpha * probs + (1 - self._alpha) * self._ema
        self._prev = best
        return self._ema

    def reset(self) -> None:
        self._ema  = None
        self._prev = -1


# ── Majority voter ────────────────────────────────────────────────────────────

class MajorityVoter:
    """Returns the most frequent class over last N inferences for stability."""

    def __init__(self, window: int = 7) -> None:
        self._buf: deque[int] = deque(maxlen=window)

    def vote(self, cls: int) -> int:
        self._buf.append(cls)
        return int(np.bincount(list(self._buf)).argmax())

    def reset(self) -> None:
        self._buf.clear()


# ── Duplicate suppressor ──────────────────────────────────────────────────────

class DuplicateSuppressor:
    """
    Prevents the same word from being emitted every 300ms continuously.
    A word is suppressed for DUPLICATE_COOLDOWN frames after emission.
    After cooldown, same word can be emitted again (user signed it twice).
    """

    def __init__(self, cooldown: int = DUPLICATE_COOLDOWN) -> None:
        self._cooldown      = cooldown
        self._last_emitted  = ""
        self._frames_since  = 0

    def should_emit(self, word: str) -> bool:
        self._frames_since += 1
        if word != self._last_emitted:
            self._last_emitted = word
            self._frames_since = 0
            return True
        if self._frames_since >= self._cooldown:
            self._frames_since = 0
            return True
        return False

    def reset(self) -> None:
        self._last_emitted = ""
        self._frames_since = 0


# ── Main classifier ───────────────────────────────────────────────────────────

class RealSignClassifier(SignClassifier):
    """
    Production BiLSTM sign classifier.
    Accumulates 15fps frames in a rolling buffer; runs inference when warm.
    All normalisation, padding, and feature layout match training exactly.
    """

    def __init__(
        self,
        model_path:  Optional[Path]         = None,
        labels_path: Optional[Path]         = None,
        device:      Optional[torch.device] = None,
        conf_thresh: float                  = CONF_THRESHOLD,
        top_k:       int                    = 3,
    ) -> None:
        self._model_path  = model_path  or cfg.paths.best_model_path
        self._labels_path = labels_path or cfg.paths.labels_json_path
        self._conf_thresh = conf_thresh
        self._top_k       = top_k
        self._max_len     = cfg.training.max_seq_len   # 60

        # Device selection
        if device is not None:
            self._device = device
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            self._device = torch.device("mps")
        else:
            self._device = torch.device("cpu")

        # State
        self._buf: deque[np.ndarray] = deque(maxlen=WINDOW_SIZE)
        self._smoother    = PredictionSmoother(alpha=0.50)
        self._voter       = MajorityVoter(window=7)
        self._suppressor  = DuplicateSuppressor(cooldown=DUPLICATE_COOLDOWN)
        self._no_hand_cnt = 0

        self._labels: list[str] = []
        self._model:  Optional[SignBuddyBiLSTM] = None
        self._load()

    # ── Init ─────────────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._labels_path.exists():
            raise FileNotFoundError(
                f"labels.json not found: {self._labels_path}\n"
                "Run: python -m training.extract_landmarks && "
                "python -m training.prepare_dataset && python -m training.train"
            )
        with open(self._labels_path) as f:
            data = json.load(f)
        self._labels = data["labels"]
        n = len(self._labels)
        log.info("Loaded %d labels from %s", n, self._labels_path)

        if not self._model_path.exists():
            raise FileNotFoundError(
                f"best_model.pth not found: {self._model_path}"
            )

        mc             = cfg.model
        mc.num_classes = n
        self._model    = SignBuddyBiLSTM(mc)
        state          = torch.load(str(self._model_path), map_location=self._device)
        self._model.load_state_dict(state)
        self._model.to(self._device)
        self._model.eval()

        # Warmup — eliminates first-call spike
        dummy = torch.zeros(1, self._max_len, _FEAT_SIZE, device=self._device)
        with torch.no_grad():
            _ = self._model(dummy)

        log.info(
            "RealSignClassifier ready | device=%s | classes=%d | "
            "window=%d@15fps | threshold=%.2f",
            self._device, n, WINDOW_SIZE, self._conf_thresh,
        )

    # ── Inference helpers ─────────────────────────────────────────────────────

    def _build_tensor(self) -> torch.Tensor:
        """
        Stack buffer → (1, 60, 225) tensor with post-padding.
        Matches dataset.py pad_or_truncate() exactly.
        """
        seq = np.stack(list(self._buf), axis=0)   # (T, 225)
        seq = _pad_or_truncate(seq, self._max_len) # (60, 225)
        return torch.from_numpy(seq).unsqueeze(0).to(self._device)  # (1, 60, 225)

    @torch.no_grad()
    def _forward(self) -> np.ndarray:
        """BiLSTM forward pass → softmax probabilities (num_classes,)."""
        logits = self._model(self._build_tensor())
        return F.softmax(logits, dim=1).squeeze(0).cpu().numpy()

    # ── Public interface ──────────────────────────────────────────────────────

    def classify_sequence(
        self, frames: list[LandmarkFrame], sign_language: str = "ISL"
    ) -> RecognitionResult:
        """
        Accumulate frames at 15fps; run inference when buffer is warm.

        Frames arriving here are pre-subsampled to 15fps by useHandLandmarker.ts.
        WINDOW_SIZE=60 @ 15fps = 4 seconds = training max_frames exactly.
        """
        t0 = time.perf_counter()

        if not frames:
            return RecognitionResult(text="", confidence=0.0, latency_ms=0, alternatives=[])

        any_hand = any(
            f.hand_landmarks_left is not None or f.hand_landmarks_right is not None
            for f in frames
        )

        # Accumulate every frame into rolling buffer
        for f in frames:
            self._buf.append(landmark_frame_to_vector(f))

        # No-hand handling: reset after 1 second with no hands
        if not any_hand:
            self._no_hand_cnt += 1
            if self._no_hand_cnt >= NO_HAND_RESET:
                self._buf.clear()
                self._smoother.reset()
                self._voter.reset()
                self._suppressor.reset()
                self._no_hand_cnt = 0
            latency_ms = int((time.perf_counter() - t0) * 1000)
            return RecognitionResult(text="", confidence=0.0, latency_ms=latency_ms, alternatives=[])

        self._no_hand_cnt = 0

        # Wait until buffer has enough real frames
        if len(self._buf) < MIN_FRAMES:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            return RecognitionResult(text="", confidence=0.0, latency_ms=latency_ms, alternatives=[])

        # Run inference
        raw_probs    = self._forward()
        smooth_probs = self._smoother.update(raw_probs)
        raw_best     = int(np.argmax(smooth_probs))
        voted_cls    = self._voter.vote(raw_best)

        latency_ms = int((time.perf_counter() - t0) * 1000)
        best_conf  = float(smooth_probs[voted_cls])

        # Confidence gate
        if best_conf < self._conf_thresh:
            return RecognitionResult(text="", confidence=best_conf, latency_ms=latency_ms, alternatives=[])

        best_label = self._labels[voted_cls]

        # Duplicate suppression — prevent repeating same word every 300ms
        if not self._suppressor.should_emit(best_label):
            return RecognitionResult(text="", confidence=best_conf, latency_ms=latency_ms, alternatives=[])

        # Build top-k alternatives
        k = min(self._top_k, len(self._labels))
        top_idx = np.argsort(smooth_probs)[::-1][:k]
        alts = [
            (self._labels[int(i)], float(smooth_probs[int(i)]))
            for i in top_idx
            if int(i) != voted_cls
        ]

        log.info(
            "✓ Recognized: %s | conf=%.3f | latency=%dms | buf=%d",
            best_label, best_conf, latency_ms, len(self._buf),
        )

        return RecognitionResult(
            text=best_label,
            confidence=round(best_conf, 4),
            latency_ms=latency_ms,
            alternatives=alts[: self._top_k - 1],
        )

    def reset_buffer(self) -> None:
        """Clear all state — called by /v1/reset between signs."""
        self._buf.clear()
        self._smoother.reset()
        self._voter.reset()
        self._suppressor.reset()
        self._no_hand_cnt = 0
        log.debug("Classifier buffer reset.")

    def score_single_sign(
        self, frames: list[LandmarkFrame], target_gloss: str, sign_language: str = "ISL"
    ) -> dict[str, Any]:
        """One-shot scoring for AI Tutor — bypasses rolling buffer."""
        if not frames:
            return {
                "predicted_gloss": "", "confidence": 0.0,
                "is_correct": False, "target_rank": -1, "target_prob": 0.0,
            }

        vecs = [landmark_frame_to_vector(f) for f in frames]
        seq  = np.stack(vecs, axis=0).astype(np.float32)
        seq  = _pad_or_truncate(seq, self._max_len)

        tensor = torch.from_numpy(seq).unsqueeze(0).to(self._device)
        with torch.no_grad():
            probs = F.softmax(self._model(tensor), dim=1).squeeze(0).cpu().numpy()

        top_idx   = int(np.argmax(probs))
        predicted = self._labels[top_idx]
        target_n  = target_gloss.upper().strip()

        t_idx = next(
            (i for i, lbl in enumerate(self._labels) if lbl.upper() == target_n),
            None,
        )
        return {
            "predicted_gloss": predicted,
            "confidence":      round(float(probs[top_idx]), 4),
            "is_correct":      predicted.upper() == target_n,
            "target_rank":     (
                np.argsort(probs)[::-1].tolist().index(t_idx) + 1
                if t_idx is not None else -1
            ),
            "target_prob":     round(float(probs[t_idx]), 4) if t_idx is not None else 0.0,
        }

    # ── Properties ───────────────────────────────────────────────────────────

    @property
    def labels(self) -> list[str]:
        return self._labels

    @property
    def num_classes(self) -> int:
        return len(self._labels)

    @property
    def device(self) -> torch.device:
        return self._device
