"""
training/config.py
------------------
Central configuration for the SignBuddy AI training pipeline.
All paths, hyperparameters, and architectural knobs live here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Directory layout
# ---------------------------------------------------------------------------

# Root of the repository (two levels up from this file)
_REPO_ROOT = Path(__file__).resolve().parents[2]

# ai-service root
_AI_ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Paths:
    """All filesystem paths used by the training pipeline."""

    # ---- Input data -------------------------------------------------------
    # Top-level dataset root (user must set via env or edit here)
    dataset_root: Path = field(
    default_factory=lambda: Path(
        os.environ.get(
            "SIGNBUDDY_DATASET_ROOT",
            r"C:\Users\gagir\Downloads\archive (1)",
        )
    )
    )

    @property
    def video_dataset_dir(self) -> Path:
        """60 class folders, each with ~20 MP4s — used for training."""
        return self.dataset_root / "Video_Dataset" / "Video_Dataset"

    @property
    def sample_videos_dir(self) -> Path:
        return self.dataset_root / "Sample Videos"

    # ---- Intermediate artefacts ------------------------------------------
    processed_data_dir: Path = field(
        default_factory=lambda: _AI_ROOT / "data" / "processed"
    )
    landmarks_file: Path = field(
        default_factory=lambda: _AI_ROOT / "data" / "processed" / "landmarks.npz"
    )
    labels_mapping_file: Path = field(
        default_factory=lambda: _AI_ROOT / "data" / "processed" / "label_map.json"
    )

    # ---- Model outputs ----------------------------------------------------
    models_dir: Path = field(default_factory=lambda: _AI_ROOT / "models")
    best_model_path: Path = field(
        default_factory=lambda: _AI_ROOT / "models" / "best_model.pth"
    )
    labels_json_path: Path = field(
        default_factory=lambda: _AI_ROOT / "models" / "labels.json"
    )
    training_history_path: Path = field(
        default_factory=lambda: _AI_ROOT / "models" / "training_history.json"
    )
    evaluation_report_path: Path = field(
        default_factory=lambda: _AI_ROOT / "models" / "evaluation_report.json"
    )
    plots_dir: Path = field(
        default_factory=lambda: _AI_ROOT / "models" / "plots"
    )

    def makedirs(self) -> None:
        """Create all output directories if they don't exist."""
        for d in [
            self.processed_data_dir,
            self.models_dir,
            self.plots_dir,
        ]:
            d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Landmark extraction
# ---------------------------------------------------------------------------

@dataclass
class LandmarkConfig:
    """Controls what MediaPipe extracts and how features are assembled."""

    # MediaPipe Holistic thresholds
    min_detection_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    model_complexity: int = 1

    # Per-hand: 21 landmarks × 3 coordinates (x, y, z)
    num_hand_landmarks: int = 21
    num_coords: int = 3  # x, y, z

    # Pose: 33 landmarks × 3 coords (upper-body only used; see extract_landmarks.py)
    num_pose_landmarks: int = 33

    # Face grammar subset (eyebrows + mouth corners)
    face_grammar_indices: list[int] = field(
        default_factory=lambda: [70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 13, 14]
    )

    # Feature vector size = left_hand + right_hand + upper_pose
    # = 21*3 + 21*3 + 33*3 = 63 + 63 + 99 = 225
    # Face grammar adds 14*3 = 42  → total 267
    # We use only hands + upper-body pose for the classifier (225 dims).
    feature_size: int = 225  # change to 267 to include face grammar

    # Video sampling
    target_fps: int = 15          # resample every video to this frame rate
    min_frames: int = 10          # discard clips shorter than this
    max_frames: int = 60          # truncate / pad to this length


# ---------------------------------------------------------------------------
# Model architecture
# ---------------------------------------------------------------------------

@dataclass
class ModelConfig:
    """BiLSTM model hyperparameters."""

    input_size: int = 225          # must match LandmarkConfig.feature_size
    hidden_size: int = 256
    num_layers: int = 3
    dropout: float = 0.4
    bidirectional: bool = True
    num_classes: int = 60          # updated automatically from dataset
    use_attention: bool = True     # temporal self-attention on top of BiLSTM


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

@dataclass
class TrainingConfig:
    """All hyperparameters for the training loop."""

    seed: int = 42
    batch_size: int = 32
    num_epochs: int = 100
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4

    # Train / validation split
    val_split: float = 0.15
    test_split: float = 0.0       # we use Sample Videos as the held-out test set

    # Scheduler
    scheduler: str = "cosine"     # "cosine" | "step" | "plateau"
    lr_step_size: int = 20        # for StepLR
    lr_gamma: float = 0.5         # for StepLR
    lr_patience: int = 8          # for ReduceLROnPlateau

    # Early stopping
    early_stopping_patience: int = 15
    early_stopping_min_delta: float = 1e-4

    # Data augmentation (applied on landmark sequences at runtime)
    augment_train: bool = True
    aug_time_warp_sigma: float = 0.2    # random temporal warping scale
    aug_noise_std: float = 0.005        # Gaussian noise on coordinates
    aug_flip_prob: float = 0.5          # horizontal flip (swap L/R hands)

    # Sequence padding
    pad_value: float = 0.0
    max_seq_len: int = 60              # must match LandmarkConfig.max_frames

    # Inference
    confidence_threshold: float = 0.5  # below this → "low confidence"
    top_k: int = 3                      # number of alternatives to return

    # Hardware
    num_workers: int = 4
    pin_memory: bool = True


# ---------------------------------------------------------------------------
# Convenience singleton
# ---------------------------------------------------------------------------

@dataclass
class Config:
    paths: Paths = field(default_factory=Paths)
    landmarks: LandmarkConfig = field(default_factory=LandmarkConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    training: TrainingConfig = field(default_factory=TrainingConfig)

    def __post_init__(self) -> None:
        # Keep model input size in sync with landmark feature size
        self.model.input_size = self.landmarks.feature_size
        # Keep max_seq_len in sync
        self.training.max_seq_len = self.landmarks.max_frames
        # Create output dirs
        self.paths.makedirs()


# Module-level default — import this in every training script
cfg = Config()
