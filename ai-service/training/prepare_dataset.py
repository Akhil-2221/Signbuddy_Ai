"""
training/prepare_dataset.py
-----------------------------
Loads the extracted landmark sequences (.npz) and builds stratified
train / validation splits, saving indices to disk so training is
fully reproducible.

Run:
    python -m training.prepare_dataset
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import numpy as np
from sklearn.model_selection import StratifiedShuffleSplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.config import cfg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Split helpers
# ---------------------------------------------------------------------------

def load_extracted_data(
    landmarks_file: Path,
    sequence_keys_file: Path,
    label_map: dict[str, int],
) -> tuple[list[np.ndarray], np.ndarray, list[str]]:
    """
    Load sequences and derive labels from the saved .npz.

    Returns:
        sequences   : list of (T_i, feature_size) arrays
        labels      : int64 array of class indices aligned with sequences
        keys        : list of "class_name/video_stem" keys
    """
    log.info("Loading landmark archive: %s", landmarks_file)
    archive = np.load(str(landmarks_file), allow_pickle=True)

    log.info("Loading key ordering: %s", sequence_keys_file)
    with open(sequence_keys_file) as f:
        keys: list[str] = json.load(f)

    sequences: list[np.ndarray] = []
    labels: list[int] = []
    valid_keys: list[str] = []

    missing = 0
    for key in keys:
        if key not in archive:
            log.debug("Key missing from archive: %s", key)
            missing += 1
            continue
        class_name = key.split("/")[0]
        if class_name not in label_map:
            log.warning("Class '%s' not in label_map — skipping.", class_name)
            continue
        sequences.append(archive[key])
        labels.append(label_map[class_name])
        valid_keys.append(key)

    if missing:
        log.warning("%d keys were referenced in sequence_keys.json but not found in .npz", missing)

    log.info("Loaded %d sequences across %d classes.", len(sequences), len(set(labels)))
    return sequences, np.array(labels, dtype=np.int64), valid_keys


def stratified_split(
    labels: np.ndarray,
    val_split: float,
    seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Stratified shuffle split → (train_indices, val_indices).

    Ensures every class is proportionally represented in both splits.
    """
    sss = StratifiedShuffleSplit(n_splits=1, test_size=val_split, random_state=seed)
    train_idx, val_idx = next(sss.split(np.zeros(len(labels)), labels))
    return train_idx, val_idx


def describe_split(
    train_idx: np.ndarray,
    val_idx: np.ndarray,
    labels: np.ndarray,
    label_map: dict[str, int],
) -> None:
    """Log a per-class breakdown of the train/val split."""
    inv_map = {v: k for k, v in label_map.items()}
    num_classes = len(label_map)
    log.info("Split summary:")
    log.info("  Train: %d samples", len(train_idx))
    log.info("  Val  : %d samples", len(val_idx))

    class_train = np.bincount(labels[train_idx], minlength=num_classes)
    class_val   = np.bincount(labels[val_idx],   minlength=num_classes)
    log.info("  Per-class (class | train | val):")
    for cls_id in range(num_classes):
        log.info("    %-20s | %3d | %3d", inv_map.get(cls_id, cls_id), class_train[cls_id], class_val[cls_id])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def prepare(val_split: Optional[float] = None, seed: Optional[int] = None) -> None:
    """
    Load extracted data, build splits, and save index files.

    Args:
        val_split: Fraction of data to use for validation (overrides config).
        seed:      Random seed for reproducibility (overrides config).
    """
    paths = cfg.paths
    tc = cfg.training

    val_split = val_split if val_split is not None else tc.val_split
    seed = seed if seed is not None else tc.seed

    # Load label map
    if not paths.labels_mapping_file.exists():
        log.error(
            "labels_mapping_file not found: %s\nRun extract_landmarks.py first.",
            paths.labels_mapping_file,
        )
        sys.exit(1)

    with open(paths.labels_mapping_file) as f:
        label_map: dict[str, int] = json.load(f)

    keys_file = paths.processed_data_dir / "sequence_keys.json"
    if not paths.landmarks_file.exists() or not keys_file.exists():
        log.error(
            "Processed data not found. Run extract_landmarks.py first.\n"
            "  Expected: %s\n  Expected: %s",
            paths.landmarks_file,
            keys_file,
        )
        sys.exit(1)

    sequences, labels, keys = load_extracted_data(
        paths.landmarks_file, keys_file, label_map
    )

    if len(sequences) == 0:
        log.error("No sequences loaded — check extraction step.")
        sys.exit(1)

    # Update num_classes in model config to match actual dataset
    actual_classes = len(set(labels.tolist()))
    if actual_classes != cfg.model.num_classes:
        log.warning(
            "Updating num_classes from %d (config) to %d (actual dataset).",
            cfg.model.num_classes,
            actual_classes,
        )
        cfg.model.num_classes = actual_classes

    # Build split
    train_idx, val_idx = stratified_split(labels, val_split, seed)
    describe_split(train_idx, val_idx, labels, label_map)

    # Persist indices
    split_dir = paths.processed_data_dir
    np.save(str(split_dir / "train_indices.npy"), train_idx)
    np.save(str(split_dir / "val_indices.npy"),   val_idx)
    log.info("Train indices → %s", split_dir / "train_indices.npy")
    log.info("Val   indices → %s", split_dir / "val_indices.npy")

    # Persist sequence stats (useful for debugging)
    seq_lengths = [len(s) for s in sequences]
    stats = {
        "num_sequences": len(sequences),
        "num_classes": actual_classes,
        "num_train": int(len(train_idx)),
        "num_val": int(len(val_idx)),
        "val_split": val_split,
        "seed": seed,
        "seq_len_min": int(min(seq_lengths)),
        "seq_len_max": int(max(seq_lengths)),
        "seq_len_mean": float(np.mean(seq_lengths)),
        "feature_size": int(sequences[0].shape[1]),
        "class_names": [k for k, v in sorted(label_map.items(), key=lambda x: x[1])],
    }
    stats_path = split_dir / "dataset_stats.json"
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)
    log.info("Dataset stats → %s", stats_path)
    log.info("✓ Dataset preparation complete.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build train/val splits from extracted landmarks")
    parser.add_argument("--val-split", type=float, default=None)
    parser.add_argument("--seed",      type=int,   default=None)
    args = parser.parse_args()
    prepare(val_split=args.val_split, seed=args.seed)
