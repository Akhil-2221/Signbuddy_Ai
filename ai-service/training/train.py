"""
training/train.py
------------------
Main training entry-point for the SignBuddy BiLSTM model.

Run:
    python -m training.train

Optional flags:
    --epochs        Override number of epochs (default from config)
    --lr            Override learning rate
    --batch-size    Override batch size
    --resume        Path to a checkpoint to resume from
    --device        Force device ('cpu', 'cuda', 'mps')
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.config import cfg
from training.dataset import load_dataloaders_from_disk
from training.utils import (
    EarlyStopping,
    build_model,
    build_scheduler,
    compute_accuracy,
    compute_confusion_matrix,
    get_device,
    save_confusion_matrix_plot,
    save_training_plots,
    set_seed,
    topk_accuracy,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# One epoch helpers
# ---------------------------------------------------------------------------

def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    device: torch.device,
    scaler: Optional[torch.cuda.amp.GradScaler],
    epoch: int,
    num_epochs: int,
) -> tuple[float, float]:
    """Run one training epoch. Returns (avg_loss, avg_accuracy)."""
    model.train()
    total_loss = 0.0
    total_acc  = 0.0
    n_batches  = len(loader)

    pbar = tqdm(loader, desc=f"Epoch {epoch}/{num_epochs} [Train]", leave=False, dynamic_ncols=True)
    for x, y in pbar:
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)

        if scaler is not None:
            with torch.cuda.amp.autocast():
                logits = model(x)
                loss   = criterion(logits, y)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            scaler.step(optimizer)
            scaler.update()
        else:
            logits = model(x)
            loss   = criterion(logits, y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()

        acc = compute_accuracy(logits.detach(), y)
        total_loss += loss.item()
        total_acc  += acc
        pbar.set_postfix(loss=f"{loss.item():.4f}", acc=f"{acc:.3f}")

    return total_loss / n_batches, total_acc / n_batches


@torch.no_grad()
def evaluate_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    num_classes: int,
    epoch: int,
    num_epochs: int,
) -> tuple[float, float, float, list[int], list[int]]:
    """
    Run one validation epoch.

    Returns:
        (avg_loss, avg_top1_acc, avg_top3_acc, all_preds, all_labels)
    """
    model.eval()
    total_loss  = 0.0
    total_top1  = 0.0
    total_top3  = 0.0
    n_batches   = len(loader)
    all_preds:  list[int] = []
    all_labels: list[int] = []

    pbar = tqdm(loader, desc=f"Epoch {epoch}/{num_epochs} [Val  ]", leave=False, dynamic_ncols=True)
    for x, y in pbar:
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        logits = model(x)
        loss   = criterion(logits, y)

        top1 = compute_accuracy(logits, y)
        top3 = topk_accuracy(logits, y, k=min(3, num_classes))

        total_loss += loss.item()
        total_top1 += top1
        total_top3 += top3

        all_preds.extend(logits.argmax(dim=1).cpu().tolist())
        all_labels.extend(y.cpu().tolist())
        pbar.set_postfix(loss=f"{loss.item():.4f}", acc=f"{top1:.3f}")

    return (
        total_loss / n_batches,
        total_top1 / n_batches,
        total_top3 / n_batches,
        all_preds,
        all_labels,
    )


# ---------------------------------------------------------------------------
# Precision / Recall helpers
# ---------------------------------------------------------------------------

def precision_recall_per_class(
    cm: "np.ndarray",
) -> tuple["np.ndarray", "np.ndarray"]:
    """Return per-class precision and recall arrays from a confusion matrix."""
    import numpy as np
    col_sums = cm.sum(axis=0, keepdims=True)
    row_sums = cm.sum(axis=1, keepdims=True)
    diag     = np.diag(cm)
    precision = np.where(col_sums.squeeze() > 0, diag / col_sums.squeeze(), 0.0)
    recall    = np.where(row_sums.squeeze() > 0, diag / row_sums.squeeze(), 0.0)
    return precision, recall


# ---------------------------------------------------------------------------
# Main training loop
# ---------------------------------------------------------------------------

def train(
    num_epochs: Optional[int]  = None,
    lr: Optional[float]        = None,
    batch_size: Optional[int]  = None,
    resume: Optional[str]      = None,
    device_override: Optional[str] = None,
) -> None:
    """
    Full training pipeline.

    1. Load DataLoaders from pre-extracted data.
    2. Build model + optimiser + scheduler + loss.
    3. Train with early stopping.
    4. Save best checkpoint, label file, training history, and plots.
    """
    import numpy as np

    tc    = cfg.training
    paths = cfg.paths

    # Apply CLI overrides
    if num_epochs  is not None: tc.num_epochs   = num_epochs
    if lr          is not None: tc.learning_rate = lr
    if batch_size  is not None: tc.batch_size    = batch_size

    set_seed(tc.seed)
    device = get_device() if device_override is None else torch.device(device_override)

    # ----- Data -----
    log.info("Loading DataLoaders …")
    train_loader, val_loader, label_map, num_classes = load_dataloaders_from_disk()

    inv_label_map: dict[int, str] = {v: k for k, v in label_map.items()}

    # ----- Model -----
    log.info("Building model (num_classes=%d) …", num_classes)
    model = build_model(num_classes).to(device)

    if resume:
        ckpt = torch.load(resume, map_location=device)
        model.load_state_dict(ckpt)
        log.info("Resumed from checkpoint: %s", resume)

    # ----- Loss / Optimiser / Scheduler -----
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=tc.learning_rate, weight_decay=tc.weight_decay
    )
    scheduler = build_scheduler(optimizer, tc.scheduler, tc.num_epochs)

    # Mixed-precision (CUDA only)
    scaler = torch.cuda.amp.GradScaler() if device.type == "cuda" else None

    early_stopping = EarlyStopping(
        patience=tc.early_stopping_patience,
        min_delta=tc.early_stopping_min_delta,
        path=paths.best_model_path,
    )

    # ----- History -----
    history: dict[str, list] = {
        "train_loss": [], "train_acc": [],
        "val_loss":   [], "val_acc":   [], "val_top3_acc": [],
        "lr": [],
    }

    log.info("=" * 60)
    log.info("Starting training — %d epochs, device=%s", tc.num_epochs, device)
    log.info("=" * 60)

    t_start = time.time()

    for epoch in range(1, tc.num_epochs + 1):
        epoch_start = time.time()

        # --- Train ---
        train_loss, train_acc = train_one_epoch(
            model, train_loader, optimizer, criterion, device, scaler, epoch, tc.num_epochs
        )

        # --- Validate ---
        val_loss, val_top1, val_top3, all_preds, all_labels = evaluate_epoch(
            model, val_loader, criterion, device, num_classes, epoch, tc.num_epochs
        )

        # --- Scheduler step ---
        if isinstance(scheduler, torch.optim.lr_scheduler.ReduceLROnPlateau):
            scheduler.step(val_loss)
        else:
            scheduler.step()
        current_lr = optimizer.param_groups[0]["lr"]

        # --- Record history ---
        history["train_loss"].append(train_loss)
        history["train_acc"].append(train_acc)
        history["val_loss"].append(val_loss)
        history["val_acc"].append(val_top1)
        history["val_top3_acc"].append(val_top3)
        history["lr"].append(current_lr)

        epoch_secs = time.time() - epoch_start
        log.info(
            "Epoch %3d/%d | loss=%.4f/%.4f | acc=%.3f/%.3f | top3_val=%.3f | lr=%.2e | %.1fs",
            epoch, tc.num_epochs,
            train_loss, val_loss,
            train_acc,  val_top1, val_top3,
            current_lr, epoch_secs,
        )

        # --- Early stopping / checkpoint ---
        early_stopping.step(val_loss, epoch, model)
        if early_stopping.stop:
            log.info("Training stopped early at epoch %d.", epoch)
            break

    total_mins = (time.time() - t_start) / 60
    log.info("Training finished in %.1f minutes.", total_mins)

    # ----- Final metrics on validation set (using best model) -----
    log.info("Loading best checkpoint for final evaluation …")
    best_state = torch.load(str(paths.best_model_path), map_location=device)
    model.load_state_dict(best_state)
    _, final_top1, final_top3, final_preds, final_labels = evaluate_epoch(
        model, val_loader, criterion, device, num_classes,
        epoch=0, num_epochs=0,
    )
    log.info("Best-model val top-1: %.4f | top-3: %.4f", final_top1, final_top3)

    cm = compute_confusion_matrix(final_preds, final_labels, num_classes)
    precision, recall = precision_recall_per_class(cm)
    macro_precision = float(precision.mean())
    macro_recall    = float(recall.mean())
    log.info("Macro precision: %.4f | Macro recall: %.4f", macro_precision, macro_recall)

    # ----- Save artefacts -----
    # labels.json (already written by extract_landmarks, but refresh it here)
    labels_list = [inv_label_map[i] for i in range(num_classes)]
    labels_payload = {"labels": labels_list, "label_map": label_map}
    with open(paths.labels_json_path, "w") as f:
        json.dump(labels_payload, f, indent=2)
    log.info("labels.json → %s", paths.labels_json_path)

    # training_history.json
    training_history = {
        "history": history,
        "best_epoch": early_stopping.best_epoch,
        "best_val_loss": float(early_stopping.best_loss),
        "final_val_top1": float(final_top1),
        "final_val_top3": float(final_top3),
        "macro_precision": macro_precision,
        "macro_recall":    macro_recall,
        "total_minutes": round(total_mins, 2),
        "num_classes": num_classes,
    }
    with open(paths.training_history_path, "w") as f:
        json.dump(training_history, f, indent=2)
    log.info("training_history.json → %s", paths.training_history_path)

    # Plots
    save_training_plots(history, paths.plots_dir)
    save_confusion_matrix_plot(
        cm,
        class_names=[inv_label_map[i] for i in range(num_classes)],
        plots_dir=paths.plots_dir,
    )

    log.info("=" * 60)
    log.info("✓ Training complete.")
    log.info("  Best model : %s", paths.best_model_path)
    log.info("  Labels     : %s", paths.labels_json_path)
    log.info("  History    : %s", paths.training_history_path)
    log.info("=" * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train the SignBuddy BiLSTM classifier")
    parser.add_argument("--epochs",     type=int,   default=None)
    parser.add_argument("--lr",         type=float, default=None)
    parser.add_argument("--batch-size", type=int,   default=None)
    parser.add_argument("--resume",     type=str,   default=None)
    parser.add_argument("--device",     type=str,   default=None, help="cpu | cuda | mps")
    args = parser.parse_args()

    train(
        num_epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
        resume=args.resume,
        device_override=args.device,
    )
