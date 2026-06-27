"""
training/utils.py
------------------
Shared utilities:
  * BiLSTM + Attention model definition
  * EarlyStopping
  * LR scheduler factory
  * Metric helpers
  * Logging / plotting helpers
"""

from __future__ import annotations

import json
import logging
import math
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.config import cfg, ModelConfig

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class TemporalAttention(nn.Module):
    """
    Additive (Bahdanau-style) self-attention over the time dimension.

    Input : (B, T, hidden_dim)
    Output: (B, hidden_dim)  — context vector
    """

    def __init__(self, hidden_dim: int) -> None:
        super().__init__()
        self.W = nn.Linear(hidden_dim, hidden_dim, bias=False)
        self.v = nn.Linear(hidden_dim, 1,           bias=False)

    def forward(self, lstm_out: Tensor) -> Tensor:  # (B, T, H)
        # Energy
        energy = torch.tanh(self.W(lstm_out))       # (B, T, H)
        scores = self.v(energy).squeeze(-1)          # (B, T)
        weights = F.softmax(scores, dim=1)           # (B, T)
        # Weighted sum
        context = (lstm_out * weights.unsqueeze(-1)).sum(dim=1)  # (B, H)
        return context


class SignBuddyBiLSTM(nn.Module):
    """
    Bidirectional LSTM with optional temporal attention for ISL recognition.

    Architecture:
        Input (B, T, input_size)
          → Linear projection → LayerNorm
          → N-layer BiLSTM with dropout between layers
          → Temporal Attention (optional) or last-hidden-state pool
          → FC head (hidden → num_classes)
    """

    def __init__(self, mc: Optional[ModelConfig] = None) -> None:
        super().__init__()
        mc = mc or cfg.model

        hidden_total = mc.hidden_size * (2 if mc.bidirectional else 1)

        # Input projection: normalise + project to hidden space
        self.input_proj = nn.Sequential(
            nn.Linear(mc.input_size, mc.hidden_size),
            nn.LayerNorm(mc.hidden_size),
            nn.ReLU(inplace=True),
            nn.Dropout(mc.dropout * 0.5),
        )

        self.lstm = nn.LSTM(
            input_size=mc.hidden_size,
            hidden_size=mc.hidden_size,
            num_layers=mc.num_layers,
            batch_first=True,
            dropout=mc.dropout if mc.num_layers > 1 else 0.0,
            bidirectional=mc.bidirectional,
        )

        self.use_attention = mc.use_attention
        if mc.use_attention:
            self.attention = TemporalAttention(hidden_total)

        self.head = nn.Sequential(
            nn.LayerNorm(hidden_total),
            nn.Dropout(mc.dropout),
            nn.Linear(hidden_total, mc.hidden_size // 2),
            nn.GELU(),
            nn.Dropout(mc.dropout * 0.5),
            nn.Linear(mc.hidden_size // 2, mc.num_classes),
        )

        self._init_weights()

    def _init_weights(self) -> None:
        for name, param in self.named_parameters():
            if "weight_ih" in name:
                nn.init.xavier_uniform_(param)
            elif "weight_hh" in name:
                nn.init.orthogonal_(param)
            elif "bias" in name:
                nn.init.zeros_(param)
                # Forget gate bias trick: set to 1 for better gradient flow
                n = param.size(0)
                param.data[n // 4 : n // 2].fill_(1.0)

    def forward(self, x: Tensor) -> Tensor:
        """
        Args:
            x: (B, T, input_size)
        Returns:
            logits: (B, num_classes)
        """
        x = self.input_proj(x)          # (B, T, hidden_size)
        lstm_out, _ = self.lstm(x)      # (B, T, hidden_total)

        if self.use_attention:
            ctx = self.attention(lstm_out)   # (B, hidden_total)
        else:
            ctx = lstm_out[:, -1, :]         # last timestep

        return self.head(ctx)           # (B, num_classes)


def build_model(num_classes: int) -> SignBuddyBiLSTM:
    """Construct model with updated class count."""
    mc = cfg.model
    mc.num_classes = num_classes
    model = SignBuddyBiLSTM(mc)
    total = sum(p.numel() for p in model.parameters() if p.requires_grad)
    log.info("Model built — trainable parameters: %s", f"{total:,}")
    return model


# ---------------------------------------------------------------------------
# Early stopping
# ---------------------------------------------------------------------------

class EarlyStopping:
    """
    Stops training when validation loss does not improve for `patience` epochs.

    Args:
        patience  : epochs to wait before stopping.
        min_delta : minimum improvement to count as an improvement.
        path      : where to save the best model checkpoint.
    """

    def __init__(
        self,
        patience: int = 15,
        min_delta: float = 1e-4,
        path: Optional[Path] = None,
    ) -> None:
        self.patience   = patience
        self.min_delta  = min_delta
        self.path       = path or cfg.paths.best_model_path
        self.best_loss  = math.inf
        self.counter    = 0
        self.best_epoch = 0
        self.stop       = False

    def step(self, val_loss: float, epoch: int, model: nn.Module) -> bool:
        """
        Call once per epoch with the current validation loss.

        Saves checkpoint if improved; sets self.stop if patience exceeded.
        Returns True if a new best was achieved.
        """
        if val_loss < self.best_loss - self.min_delta:
            self.best_loss  = val_loss
            self.best_epoch = epoch
            self.counter    = 0
            torch.save(model.state_dict(), str(self.path))
            log.info("  ✓ New best — val_loss=%.4f — checkpoint saved.", val_loss)
            return True
        else:
            self.counter += 1
            log.debug("  EarlyStopping counter: %d/%d", self.counter, self.patience)
            if self.counter >= self.patience:
                log.info(
                    "Early stopping triggered. Best epoch: %d, best val_loss: %.4f",
                    self.best_epoch,
                    self.best_loss,
                )
                self.stop = True
            return False


# ---------------------------------------------------------------------------
# LR scheduler factory
# ---------------------------------------------------------------------------

def build_scheduler(
    optimizer: torch.optim.Optimizer,
    scheduler_name: str = "cosine",
    num_epochs: int = 100,
) -> torch.optim.lr_scheduler._LRScheduler:
    """Build one of the supported LR schedulers."""
    tc = cfg.training

    if scheduler_name == "cosine":
        return torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=num_epochs, eta_min=1e-6
        )
    elif scheduler_name == "step":
        return torch.optim.lr_scheduler.StepLR(
            optimizer, step_size=tc.lr_step_size, gamma=tc.lr_gamma
        )
    elif scheduler_name == "plateau":
        return torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer,
            mode="min",
            factor=tc.lr_gamma,
            patience=tc.lr_patience,
            min_lr=1e-6,
        )
    else:
        raise ValueError(f"Unknown scheduler: {scheduler_name!r}")


# ---------------------------------------------------------------------------
# Metric helpers
# ---------------------------------------------------------------------------

def compute_accuracy(logits: Tensor, labels: Tensor) -> float:
    """Top-1 accuracy as a Python float."""
    preds = logits.argmax(dim=1)
    return (preds == labels).float().mean().item()


def topk_accuracy(logits: Tensor, labels: Tensor, k: int = 3) -> float:
    """Top-k accuracy."""
    _, topk_preds = logits.topk(k, dim=1)
    correct = topk_preds.eq(labels.unsqueeze(1).expand_as(topk_preds))
    return correct.any(dim=1).float().mean().item()


# ---------------------------------------------------------------------------
# Confusion matrix
# ---------------------------------------------------------------------------

def compute_confusion_matrix(
    all_preds: list[int],
    all_labels: list[int],
    num_classes: int,
) -> np.ndarray:
    """Compute an (num_classes × num_classes) confusion matrix."""
    cm = np.zeros((num_classes, num_classes), dtype=np.int64)
    for pred, true in zip(all_preds, all_labels):
        cm[true, pred] += 1
    return cm


# ---------------------------------------------------------------------------
# Plotting (matplotlib, gracefully skipped if not installed)
# ---------------------------------------------------------------------------

def save_training_plots(history: dict, plots_dir: Path) -> None:
    """Save loss and accuracy curves as PNG files."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        log.warning("matplotlib not installed — skipping training plots.")
        return

    plots_dir.mkdir(parents=True, exist_ok=True)
    epochs = range(1, len(history["train_loss"]) + 1)

    # --- Loss ---
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(epochs, history["train_loss"], label="Train Loss")
    ax.plot(epochs, history["val_loss"],   label="Val Loss")
    ax.set_xlabel("Epoch"); ax.set_ylabel("Loss")
    ax.set_title("Training & Validation Loss")
    ax.legend(); ax.grid(True)
    fig.tight_layout()
    fig.savefig(str(plots_dir / "loss.png"), dpi=150)
    plt.close(fig)

    # --- Accuracy ---
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(epochs, history["train_acc"], label="Train Accuracy")
    ax.plot(epochs, history["val_acc"],   label="Val Accuracy")
    ax.set_xlabel("Epoch"); ax.set_ylabel("Accuracy")
    ax.set_title("Training & Validation Accuracy")
    ax.legend(); ax.grid(True)
    fig.tight_layout()
    fig.savefig(str(plots_dir / "accuracy.png"), dpi=150)
    plt.close(fig)

    # --- LR ---
    if "lr" in history:
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.plot(epochs, history["lr"], label="Learning Rate")
        ax.set_xlabel("Epoch"); ax.set_ylabel("LR")
        ax.set_title("Learning Rate Schedule")
        ax.set_yscale("log"); ax.legend(); ax.grid(True)
        fig.tight_layout()
        fig.savefig(str(plots_dir / "learning_rate.png"), dpi=150)
        plt.close(fig)

    log.info("Training plots saved to %s", plots_dir)


def save_confusion_matrix_plot(
    cm: np.ndarray,
    class_names: list[str],
    plots_dir: Path,
) -> None:
    """Save a colour-coded confusion matrix PNG."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return

    fig, ax = plt.subplots(figsize=(max(12, len(class_names) * 0.4),) * 2)
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    fig.colorbar(im)
    tick_marks = np.arange(len(class_names))
    ax.set_xticks(tick_marks); ax.set_yticks(tick_marks)
    ax.set_xticklabels(class_names, rotation=90, fontsize=6)
    ax.set_yticklabels(class_names, fontsize=6)
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title("Confusion Matrix")
    fig.tight_layout()
    fig.savefig(str(plots_dir / "confusion_matrix.png"), dpi=150)
    plt.close(fig)
    log.info("Confusion matrix saved to %s", plots_dir / "confusion_matrix.png")


# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------

def set_seed(seed: int) -> None:
    """Set global random seeds for reproducibility."""
    import random
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


def get_device() -> torch.device:
    """Return the best available device."""
    if torch.cuda.is_available():
        device = torch.device("cuda")
        log.info("Using device: %s (%s)", device, torch.cuda.get_device_name(0))
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
        log.info("Using device: %s (Apple Silicon)", device)
    else:
        device = torch.device("cpu")
        log.info("Using device: cpu (no GPU detected)")
    return device
