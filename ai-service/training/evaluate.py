"""
training/evaluate.py
---------------------
Post-training evaluation using the held-out Sample Videos.

For each MP4 in Archive/Sample Videos/:
  1. Extract MediaPipe landmarks.
  2. Run inference with the trained BiLSTM (best_model.pth).
  3. Report prediction, confidence, latency, and top-3 alternatives.

Outputs:
  * models/evaluation_report.json   — machine-readable full report
  * Console summary table

Run:
    python -m training.evaluate

Optional flags:
    --model-path    Override path to best_model.pth
    --device        Force device
    --threshold     Confidence threshold (default from config)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from training.config import cfg
from training.extract_landmarks import extract_video_landmarks
from training.utils import SignBuddyBiLSTM, get_device, set_seed
from training.dataset import pad_or_truncate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Inference on a single video file
# ---------------------------------------------------------------------------

def infer_video(
    video_path: Path,
    model: torch.nn.Module,
    labels: list[str],
    device: torch.device,
    max_seq_len: int,
    top_k: int = 3,
    confidence_threshold: float = 0.5,
) -> dict:
    """
    Run full inference on a single MP4 file.

    Returns a result dict with keys:
        video, prediction, confidence, latency_ms, top_k, low_confidence, error
    """
    t0 = time.perf_counter()

    # --- Extract landmarks ---
    try:
        seq = extract_video_landmarks(video_path, cfg.landmarks)
    except Exception as exc:
        return {
            "video": video_path.name,
            "error": str(exc),
            "prediction": None,
            "confidence": 0.0,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    if seq is None:
        return {
            "video": video_path.name,
            "error": "No landmarks detected (too few frames or no hands visible)",
            "prediction": None,
            "confidence": 0.0,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    # --- Pad/truncate ---
    seq = pad_or_truncate(seq, max_seq_len)
    x = torch.from_numpy(seq).unsqueeze(0).to(device)  # (1, T, F)

    # --- Model forward pass ---
    model.eval()
    with torch.no_grad():
        logits = model(x)                               # (1, num_classes)
        probs  = F.softmax(logits, dim=1).squeeze(0)   # (num_classes,)

    latency_ms = int((time.perf_counter() - t0) * 1000)

    # --- Top-k ---
    k = min(top_k, len(labels))
    topk_probs, topk_ids = probs.topk(k)
    topk_probs = topk_probs.cpu().tolist()
    topk_ids   = topk_ids.cpu().tolist()

    best_label = labels[topk_ids[0]]
    best_conf  = topk_probs[0]
    low_conf   = best_conf < confidence_threshold

    alternatives = [
        {"label": labels[idx], "confidence": round(prob, 4)}
        for idx, prob in zip(topk_ids[1:], topk_probs[1:])
    ]

    return {
        "video":          video_path.name,
        "prediction":     best_label,
        "confidence":     round(best_conf, 4),
        "low_confidence": low_conf,
        "latency_ms":     latency_ms,
        "top_k":          [
            {"label": labels[idx], "confidence": round(prob, 4)}
            for idx, prob in zip(topk_ids, topk_probs)
        ],
        "alternatives":   alternatives,
        "error":          None,
    }


# ---------------------------------------------------------------------------
# Aggregate metrics
# ---------------------------------------------------------------------------

def summarise_results(results: list[dict]) -> dict:
    """Compute aggregate metrics over all evaluated videos."""
    valid = [r for r in results if r["error"] is None and r["prediction"] is not None]
    if not valid:
        return {"error": "No valid results"}

    confidences  = [r["confidence"] for r in valid]
    latencies    = [r["latency_ms"] for r in valid]
    low_conf_cnt = sum(1 for r in valid if r["low_confidence"])

    # Check if ground truth can be inferred from filename pattern
    # (e.g. "HELLO_001.mp4" → ground truth = "HELLO")
    correct = 0
    total_with_gt = 0
    for r in valid:
        stem = Path(r["video"]).stem.upper()
        for part in stem.split("_"):
            # If any underscore-split token matches the prediction exactly
            # treat it as ground-truth match
            pass  # filename-based GT is unreliable for sample videos; skip

    return {
        "total_videos":    len(results),
        "successful":      len(valid),
        "errors":          len(results) - len(valid),
        "low_confidence":  low_conf_cnt,
        "mean_confidence": round(float(np.mean(confidences)), 4),
        "min_confidence":  round(float(np.min(confidences)),  4),
        "max_confidence":  round(float(np.max(confidences)),  4),
        "mean_latency_ms": round(float(np.mean(latencies)),   2),
        "min_latency_ms":  int(np.min(latencies)),
        "max_latency_ms":  int(np.max(latencies)),
        "p95_latency_ms":  int(np.percentile(latencies, 95)),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def evaluate(
    model_path: Optional[Path] = None,
    device_override: Optional[str] = None,
    confidence_threshold: Optional[float] = None,
) -> None:
    """
    Evaluate the trained model on all Sample Videos and generate a report.
    """
    set_seed(cfg.training.seed)
    paths  = cfg.paths
    tc     = cfg.training
    lm_cfg = cfg.landmarks

    model_path = model_path or paths.best_model_path
    conf_thresh = confidence_threshold or tc.confidence_threshold
    device = get_device() if device_override is None else torch.device(device_override)

    # --- Load labels ---
    if not paths.labels_json_path.exists():
        log.error("labels.json not found at %s — run training first.", paths.labels_json_path)
        sys.exit(1)

    with open(paths.labels_json_path) as f:
        labels_data = json.load(f)
    labels: list[str] = labels_data["labels"]
    num_classes = len(labels)
    log.info("Loaded %d class labels.", num_classes)

    # --- Load model ---
    if not model_path.exists():
        log.error("Model checkpoint not found: %s", model_path)
        sys.exit(1)

    from training.config import ModelConfig
    mc = cfg.model
    mc.num_classes = num_classes
    model = SignBuddyBiLSTM(mc).to(device)
    state = torch.load(str(model_path), map_location=device)
    model.load_state_dict(state)
    model.eval()
    log.info("Loaded model from %s", model_path)

    # --- Find sample videos ---
    sample_dir = paths.sample_videos_dir
    if not sample_dir.exists():
        log.error("Sample Videos directory not found: %s", sample_dir)
        sys.exit(1)

    mp4_files = sorted(sample_dir.glob("*.mp4"))
    if not mp4_files:
        log.error("No MP4 files found in %s", sample_dir)
        sys.exit(1)

    log.info("Evaluating %d sample videos …", len(mp4_files))

    # --- Run inference ---
    results = []
    for video_path in mp4_files:
        log.info("  Processing: %s", video_path.name)
        result = infer_video(
            video_path=video_path,
            model=model,
            labels=labels,
            device=device,
            max_seq_len=tc.max_seq_len,
            top_k=tc.top_k,
            confidence_threshold=conf_thresh,
        )
        results.append(result)
        if result["error"]:
            log.warning("    ✗ Error: %s", result["error"])
        else:
            flag = " ⚠ (low confidence)" if result["low_confidence"] else ""
            log.info(
                "    ✓ Prediction: %-20s | Confidence: %.3f | Latency: %dms%s",
                result["prediction"], result["confidence"], result["latency_ms"], flag,
            )
            top3_str = " | ".join(
                f'{a["label"]} ({a["confidence"]:.3f})'
                for a in result["top_k"]
            )
            log.info("      Top-%d: %s", tc.top_k, top3_str)

    # --- Aggregate ---
    summary = summarise_results(results)

    log.info("")
    log.info("=" * 60)
    log.info("Evaluation Summary")
    log.info("=" * 60)
    for k, v in summary.items():
        log.info("  %-25s: %s", k, v)

    # --- Save report ---
    report = {
        "summary":       summary,
        "results":       results,
        "model_path":    str(model_path),
        "confidence_threshold": conf_thresh,
    }
    paths.makedirs()
    with open(paths.evaluation_report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    log.info("✓ Evaluation report → %s", paths.evaluation_report_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate trained model on Sample Videos")
    parser.add_argument("--model-path", type=str, default=None)
    parser.add_argument("--device",     type=str, default=None)
    parser.add_argument("--threshold",  type=float, default=None)
    args = parser.parse_args()

    evaluate(
        model_path=Path(args.model_path) if args.model_path else None,
        device_override=args.device,
        confidence_threshold=args.threshold,
    )
