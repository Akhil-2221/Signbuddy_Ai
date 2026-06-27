"""
training/extract_landmarks.py
------------------------------
Reads every MP4 in Video_Dataset/, extracts MediaPipe Holistic landmarks for
each frame, normalises them, and saves a single compressed NumPy archive
(landmarks.npz) plus a JSON label map.

Run:
    python -m training.extract_landmarks

Optional flags:
    --dataset-root   Override the dataset root path from config.
    --workers        Number of parallel worker processes (default: 4).
    --resume         Skip videos already present in a partial .npz.
"""

from __future__ import annotations

import argparse
import json
import logging
import multiprocessing as mp
import os
import sys
import time
import warnings
from pathlib import Path
from typing import Optional

import cv2
import mediapipe as _mp
import numpy as np
from tqdm import tqdm

# Add project root to path when run as __main__
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.config import cfg, LandmarkConfig

warnings.filterwarnings("ignore")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

_mp_holistic = _mp.solutions.holistic


# ---------------------------------------------------------------------------
# Feature construction helpers
# ---------------------------------------------------------------------------

def _lm_to_arr(lm_list, n: int) -> np.ndarray:
    """Convert a MediaPipe NormalizedLandmarkList → (n, 3) float32 array."""
    if lm_list is None:
        return np.zeros((n, 3), dtype=np.float32)
    arr = np.array([[lm.x, lm.y, lm.z] for lm in lm_list.landmark[:n]], dtype=np.float32)
    if len(arr) < n:
        arr = np.pad(arr, ((0, n - len(arr)), (0, 0)))
    return arr


def _normalise_hand(hand: np.ndarray) -> np.ndarray:
    """
    Translate wrist to origin and scale by the max spread of knuckle landmarks.

    This makes the feature invariant to where in the frame the hand appears
    and to rough scale differences between signers.
    """
    if np.allclose(hand, 0):
        return hand
    # Translate: wrist (index 0) becomes origin
    hand = hand - hand[0:1, :]
    # Scale: normalise by distance between wrist and middle-finger MCP (index 9)
    scale = np.linalg.norm(hand[9])
    if scale > 1e-6:
        hand = hand / scale
    return hand


def _normalise_pose(pose: np.ndarray) -> np.ndarray:
    """
    Translate to mid-hip and scale by shoulder width.

    Only upper-body landmarks (indices 0-24) carry sign-language signal;
    the rest (legs, feet) add noise.
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


def build_feature_vector(results, lm_cfg: LandmarkConfig) -> np.ndarray:
    """
    Assemble one flat feature vector from a MediaPipe Holistic result.

    Layout (225 values):
        left_hand  : 21 × 3 = 63
        right_hand : 21 × 3 = 63
        pose       : 33 × 3 = 99   (upper body, normalised)
    """
    left = _normalise_hand(
        _lm_to_arr(results.left_hand_landmarks, lm_cfg.num_hand_landmarks)
    )
    right = _normalise_hand(
        _lm_to_arr(results.right_hand_landmarks, lm_cfg.num_hand_landmarks)
    )
    pose = _normalise_pose(
        _lm_to_arr(results.pose_landmarks, lm_cfg.num_pose_landmarks)
    )

    return np.concatenate([left.flatten(), right.flatten(), pose.flatten()])


# ---------------------------------------------------------------------------
# Per-video extraction
# ---------------------------------------------------------------------------

def extract_video_landmarks(
    video_path: Path,
    lm_cfg: LandmarkConfig,
) -> Optional[np.ndarray]:
    """
    Extract normalised landmark sequences from a single MP4.

    Returns:
        np.ndarray of shape (T, feature_size) or None if extraction failed.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        log.warning("Cannot open video: %s", video_path)
        return None

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    sample_every = max(1, round(src_fps / lm_cfg.target_fps))

    frames: list[np.ndarray] = []

    holistic = _mp_holistic.Holistic(
        static_image_mode=False,
        model_complexity=lm_cfg.model_complexity,
        min_detection_confidence=lm_cfg.min_detection_confidence,
        min_tracking_confidence=lm_cfg.min_tracking_confidence,
    )

    frame_idx = 0
    try:
        while True:
            ret, bgr = cap.read()
            if not ret:
                break
            if frame_idx % sample_every == 0:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False
                results = holistic.process(rgb)
                vec = build_feature_vector(results, lm_cfg)
                frames.append(vec)
            frame_idx += 1
    finally:
        cap.release()
        holistic.close()

    if len(frames) < lm_cfg.min_frames:
        log.debug("Too few frames (%d) in %s — skipping.", len(frames), video_path.name)
        return None

    seq = np.stack(frames, axis=0)  # (T, feature_size)

    # Truncate long sequences
    if len(seq) > lm_cfg.max_frames:
        # Centre-crop preserves the most informative segment of the sign
        start = (len(seq) - lm_cfg.max_frames) // 2
        seq = seq[start : start + lm_cfg.max_frames]

    return seq.astype(np.float32)


# ---------------------------------------------------------------------------
# Worker function (used by multiprocessing)
# ---------------------------------------------------------------------------

def _worker_fn(args: tuple) -> tuple[str, str, Optional[np.ndarray]]:
    """Process one video; returns (class_name, video_stem, sequence | None)."""
    video_path, class_name, lm_cfg = args
    try:
        seq = extract_video_landmarks(Path(video_path), lm_cfg)
        return class_name, Path(video_path).stem, seq
    except Exception as exc:  # noqa: BLE001
        log.error("Error processing %s: %s", video_path, exc)
        return class_name, Path(video_path).stem, None


# ---------------------------------------------------------------------------
# Main extraction driver
# ---------------------------------------------------------------------------

def extract_all(
    dataset_root: Optional[Path] = None,
    num_workers: int = 4,
    resume: bool = False,
) -> None:
    """
    Walk Video_Dataset/, extract landmarks for every MP4, and save .npz.

    Args:
        dataset_root: Override cfg.paths.dataset_root.
        num_workers:  Parallel processes.
        resume:       If True and .npz already exists, skip done videos.
    """
    lm_cfg = cfg.landmarks
    paths = cfg.paths
    if dataset_root is not None:
        paths.dataset_root = Path(dataset_root)
    paths.makedirs()

    video_dataset = paths.video_dataset_dir
    if not video_dataset.exists():
        log.error("Video_Dataset not found at: %s", video_dataset)
        sys.exit(1)

    # Collect all (video_path, class_name) pairs
    class_dirs = sorted([d for d in video_dataset.iterdir() if d.is_dir()])
    if not class_dirs:
        log.error("No class directories found in %s", video_dataset)
        sys.exit(1)

    log.info("Found %d class directories.", len(class_dirs))

    # Build label map: class_name → integer index (sorted for reproducibility)
    label_map: dict[str, int] = {d.name: i for i, d in enumerate(class_dirs)}
    with open(paths.labels_mapping_file, "w") as f:
        json.dump(label_map, f, indent=2)
    log.info("Label map saved → %s", paths.labels_mapping_file)

    # Also write the final labels.json expected by the classifier
    labels_list = [d.name for d in class_dirs]
    with open(paths.labels_json_path, "w") as f:
        json.dump({"labels": labels_list, "label_map": label_map}, f, indent=2)
    log.info("labels.json saved → %s", paths.labels_json_path)

    # Build task list
    tasks: list[tuple[str, str, LandmarkConfig]] = []
    for class_dir in class_dirs:
        for mp4 in sorted(class_dir.glob("*.mp4")):
            tasks.append((str(mp4), class_dir.name, lm_cfg))

    log.info("Total videos to process: %d", len(tasks))

    # Load existing data if resuming
    existing: dict[str, np.ndarray] = {}
    existing_labels: dict[str, int] = {}
    if resume and paths.landmarks_file.exists():
        log.info("Resume mode: loading existing landmarks …")
        data = np.load(str(paths.landmarks_file), allow_pickle=True)
        for key in data.files:
            existing[key] = data[key]
        log.info("  Loaded %d existing sequences.", len(existing))

    # Run extraction (parallel)
    sequences: dict[str, np.ndarray] = dict(existing)
    label_indices: dict[str, int] = {}
    skipped = 0
    errors = 0

    ctx = mp.get_context("spawn")
    with ctx.Pool(processes=num_workers) as pool:
        for class_name, stem, seq in tqdm(
            pool.imap_unordered(_worker_fn, tasks),
            total=len(tasks),
            desc="Extracting landmarks",
            unit="video",
            dynamic_ncols=True,
        ):
            key = f"{class_name}/{stem}"
            if resume and key in existing:
                continue
            if seq is None:
                errors += 1
                continue
            sequences[key] = seq
            label_indices[key] = label_map[class_name]

    log.info(
        "Extraction complete. Successful: %d | Skipped (resume): %d | Errors: %d",
        len(sequences) - len(existing),
        len(existing),
        errors,
    )

    if not sequences:
        log.error("No sequences extracted. Check dataset path and video files.")
        sys.exit(1)

    # Build label array aligned with sequences dict
    all_keys = list(sequences.keys())
    # Re-derive label indices for all keys (including resumed ones)
    all_label_indices = []
    for key in all_keys:
        class_name = key.split("/")[0]
        all_label_indices.append(label_map[class_name])

    log.info("Saving landmarks to %s …", paths.landmarks_file)
    np.savez_compressed(
        str(paths.landmarks_file),
        **{k: v for k, v in sequences.items()},
    )

    # Save a separate label-index array in the same order
    label_arr_path = paths.processed_data_dir / "label_indices.npy"
    np.save(str(label_arr_path), np.array(all_label_indices, dtype=np.int64))
    log.info("Saved label indices → %s", label_arr_path)

    # Save key ordering so dataset.py can reconstruct (key → label) mapping
    keys_path = paths.processed_data_dir / "sequence_keys.json"
    with open(keys_path, "w") as f:
        json.dump(all_keys, f)
    log.info("Saved sequence keys → %s", keys_path)

    log.info("✓ Landmark extraction done. %d sequences saved.", len(sequences))

    # Quick sanity summary
    class_counts: dict[str, int] = {}
    for key in all_keys:
        cls = key.split("/")[0]
        class_counts[cls] = class_counts.get(cls, 0) + 1
    min_cls = min(class_counts.values())
    max_cls = max(class_counts.values())
    log.info(
        "Class distribution: min=%d, max=%d, mean=%.1f per class",
        min_cls,
        max_cls,
        sum(class_counts.values()) / len(class_counts),
    )


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract MediaPipe landmarks from Video_Dataset")
    parser.add_argument(
        "--dataset-root",
        type=str,
        default=None,
        help="Override dataset root path (default: from config.py)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel worker processes (default: 4)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip videos already in the existing .npz file",
    )
    args = parser.parse_args()

    extract_all(
        dataset_root=args.dataset_root,
        num_workers=args.workers,
        resume=args.resume,
    )