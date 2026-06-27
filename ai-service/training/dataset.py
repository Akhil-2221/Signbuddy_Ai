"""
training/dataset.py
--------------------
PyTorch Dataset and DataLoader factories for the SignBuddy landmark sequences.

The dataset:
  * Loads pre-extracted .npz sequences.
  * Pads / truncates every sequence to a fixed length.
  * Optionally applies sequence augmentation (time warp, noise, LR flip).
  * Returns (sequence_tensor, label_tensor) pairs.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import DataLoader, Dataset

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.config import cfg, TrainingConfig

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Augmentation functions  (operate on numpy arrays, shape: T × feature_size)
# ---------------------------------------------------------------------------

def _time_warp(seq: np.ndarray, sigma: float) -> np.ndarray:
    """Randomly stretch / compress the time axis using linear interpolation."""
    T = len(seq)
    if T < 4:
        return seq
    # Sample a warp factor from a log-normal distribution centred at 1.0
    factor = np.random.lognormal(mean=0.0, sigma=sigma)
    new_T = max(4, int(round(T * factor)))
    old_t = np.linspace(0, 1, T)
    new_t = np.linspace(0, 1, new_T)
    warped = np.zeros((new_T, seq.shape[1]), dtype=np.float32)
    for feat in range(seq.shape[1]):
        warped[:, feat] = np.interp(new_t, old_t, seq[:, feat])
    return warped


def _add_noise(seq: np.ndarray, std: float) -> np.ndarray:
    """Add zero-mean Gaussian noise to non-zero entries (leave padding intact)."""
    mask = (seq != 0).astype(np.float32)
    noise = np.random.normal(0, std, seq.shape).astype(np.float32)
    return seq + noise * mask


def _flip_lr(seq: np.ndarray) -> np.ndarray:
    """
    Swap left-hand and right-hand features to simulate a mirrored view.

    Feature layout (from extract_landmarks.py):
        [0:63]   left hand  (21 × 3)
        [63:126] right hand (21 × 3)
        [126:]   pose       (33 × 3)

    For the pose, x-coordinates are negated to mirror horizontally.
    """
    seq = seq.copy()
    left  = seq[:, :63].copy()
    right = seq[:, 63:126].copy()
    # Swap
    seq[:, :63]   = right
    seq[:, 63:126] = left
    # Negate x in pose (every 3rd value starting at 126)
    seq[:, 126::3] = -seq[:, 126::3]
    return seq


def augment_sequence(seq: np.ndarray, tc: TrainingConfig) -> np.ndarray:
    """Apply random augmentations to a landmark sequence."""
    if tc.aug_time_warp_sigma > 0:
        seq = _time_warp(seq, tc.aug_time_warp_sigma)
    if tc.aug_noise_std > 0:
        seq = _add_noise(seq, tc.aug_noise_std)
    if np.random.random() < tc.aug_flip_prob:
        seq = _flip_lr(seq)
    return seq


# ---------------------------------------------------------------------------
# Padding / truncation
# ---------------------------------------------------------------------------

def pad_or_truncate(seq: np.ndarray, max_len: int, pad_value: float = 0.0) -> np.ndarray:
    """
    Ensure the sequence has exactly max_len frames.

    Long sequences are centre-cropped; short ones are post-padded.
    """
    T, F = seq.shape
    if T == max_len:
        return seq
    if T > max_len:
        start = (T - max_len) // 2
        return seq[start : start + max_len]
    # Pad
    pad = np.full((max_len - T, F), fill_value=pad_value, dtype=np.float32)
    return np.concatenate([seq, pad], axis=0)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class SignLandmarkDataset(Dataset):
    """
    PyTorch dataset wrapping pre-extracted landmark sequences.

    Args:
        sequences  : list of (T_i, feature_size) float32 arrays.
        labels     : int64 array of class indices.
        max_len    : fixed sequence length after padding/truncation.
        augment    : whether to apply data augmentation.
        tc         : TrainingConfig (contains augmentation hyper-params).
    """

    def __init__(
        self,
        sequences: list[np.ndarray],
        labels: np.ndarray,
        max_len: int,
        augment: bool = False,
        tc: Optional[TrainingConfig] = None,
    ) -> None:
        assert len(sequences) == len(labels), "sequences and labels must be same length"
        self.sequences = sequences
        self.labels    = labels.astype(np.int64)
        self.max_len   = max_len
        self.augment   = augment
        self.tc        = tc or cfg.training

    def __len__(self) -> int:
        return len(self.sequences)

    def __getitem__(self, idx: int) -> tuple[Tensor, Tensor]:
        seq = self.sequences[idx].copy()  # (T, F)

        if self.augment and self.tc.augment_train:
            seq = augment_sequence(seq, self.tc)

        seq = pad_or_truncate(seq, self.max_len, self.tc.pad_value)

        x = torch.from_numpy(seq)                               # (max_len, F)
        y = torch.tensor(self.labels[idx], dtype=torch.long)
        return x, y


# ---------------------------------------------------------------------------
# DataLoader factory
# ---------------------------------------------------------------------------

def make_dataloaders(
    sequences: list[np.ndarray],
    labels: np.ndarray,
    train_indices: np.ndarray,
    val_indices: np.ndarray,
) -> tuple[DataLoader, DataLoader]:
    """
    Build train and validation DataLoaders from pre-split index arrays.

    Returns:
        (train_loader, val_loader)
    """
    tc = cfg.training

    train_seqs   = [sequences[i] for i in train_indices]
    train_labels = labels[train_indices]
    val_seqs     = [sequences[i] for i in val_indices]
    val_labels   = labels[val_indices]

    train_ds = SignLandmarkDataset(
        train_seqs, train_labels, max_len=tc.max_seq_len, augment=True, tc=tc
    )
    val_ds = SignLandmarkDataset(
        val_seqs, val_labels, max_len=tc.max_seq_len, augment=False, tc=tc
    )

    train_loader = DataLoader(
        train_ds,
        batch_size=tc.batch_size,
        shuffle=True,
        num_workers=tc.num_workers,
        pin_memory=tc.pin_memory,
        drop_last=True,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=tc.batch_size,
        shuffle=False,
        num_workers=tc.num_workers,
        pin_memory=tc.pin_memory,
        drop_last=False,
    )

    log.info(
        "DataLoaders ready — train: %d batches (%d samples) | val: %d batches (%d samples)",
        len(train_loader), len(train_ds),
        len(val_loader),   len(val_ds),
    )
    return train_loader, val_loader


# ---------------------------------------------------------------------------
# Convenience: load everything from disk and return DataLoaders
# ---------------------------------------------------------------------------

def load_dataloaders_from_disk() -> tuple[DataLoader, DataLoader, dict[str, int], int]:
    """
    Full pipeline: read .npz + index files → return DataLoaders + metadata.

    Returns:
        (train_loader, val_loader, label_map, num_classes)
    """
    paths = cfg.paths

    with open(paths.labels_mapping_file) as f:
        label_map: dict[str, int] = json.load(f)

    keys_file = paths.processed_data_dir / "sequence_keys.json"
    with open(keys_file) as f:
        keys: list[str] = json.load(f)

    archive = np.load(str(paths.landmarks_file), allow_pickle=True)
    sequences: list[np.ndarray] = []
    labels: list[int] = []
    for key in keys:
        if key not in archive:
            continue
        class_name = key.split("/")[0]
        if class_name not in label_map:
            continue
        sequences.append(archive[key])
        labels.append(label_map[class_name])

    labels_arr = np.array(labels, dtype=np.int64)

    train_indices = np.load(str(paths.processed_data_dir / "train_indices.npy"))
    val_indices   = np.load(str(paths.processed_data_dir / "val_indices.npy"))

    train_loader, val_loader = make_dataloaders(
        sequences, labels_arr, train_indices, val_indices
    )

    num_classes = len(label_map)
    return train_loader, val_loader, label_map, num_classes
