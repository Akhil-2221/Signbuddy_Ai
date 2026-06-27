"""
REAL CODE — not mocked.

Extracts hand, pose, and face landmarks from video frames using MediaPipe's
Holistic solution. This is the genuine computer-vision portion of SignBuddy's
pipeline: given raw frames, it produces normalized keypoint coordinates that
a sign-classification model (real or mock) consumes downstream.

This module can be run standalone against a webcam or video file to verify
extraction works, independent of any classifier:

    python -m pipeline.landmark_extractor --source 0   # webcam
"""

from __future__ import annotations

import argparse
import time

import cv2
import mediapipe as mp
import numpy as np

from pipeline.interfaces import LandmarkFrame

mp_holistic = mp.solutions.holistic


def _landmarks_to_array(landmark_list, expected_count: int) -> list[list[float]] | None:
    if landmark_list is None:
        return None
    return [[lm.x, lm.y, lm.z] for lm in landmark_list.landmark][:expected_count]


class HolisticLandmarkExtractor:
    """Wraps MediaPipe Holistic for hand + pose + face extraction."""

    def __init__(
        self,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        model_complexity: int = 1,
    ):
        self._holistic = mp_holistic.Holistic(
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
            model_complexity=model_complexity,
            refine_face_landmarks=True,  # needed for eyebrow/mouth grammar cues
        )

    def extract(self, frame_bgr: np.ndarray, timestamp_ms: int) -> LandmarkFrame:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        frame_rgb.flags.writeable = False
        results = self._holistic.process(frame_rgb)

        # Face: only keep the grammar-relevant subset (eyebrows + mouth corners)
        # rather than all 468 points, to keep payloads small over the wire.
        face_subset = None
        if results.face_landmarks is not None:
            GRAMMAR_INDICES = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 61, 291, 13, 14]
            face_subset = [
                [results.face_landmarks.landmark[i].x, results.face_landmarks.landmark[i].y, results.face_landmarks.landmark[i].z]
                for i in GRAMMAR_INDICES
            ]

        return LandmarkFrame(
            hand_landmarks_left=_landmarks_to_array(results.left_hand_landmarks, 21),
            hand_landmarks_right=_landmarks_to_array(results.right_hand_landmarks, 21),
            pose_landmarks=_landmarks_to_array(results.pose_landmarks, 33),
            face_landmarks=face_subset,
            timestamp_ms=timestamp_ms,
        )

    def close(self):
        self._holistic.close()


def _run_demo(source):
    """Standalone verification: draws landmark overlay on webcam/video feed."""
    mp_drawing = mp.solutions.drawing_utils
    extractor = HolisticLandmarkExtractor()
    cap = cv2.VideoCapture(source)

    start = time.time()
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break

        timestamp_ms = int((time.time() - start) * 1000)
        landmarks = extractor.extract(frame, timestamp_ms)

        detected = []
        if landmarks.hand_landmarks_left:
            detected.append("L-hand")
        if landmarks.hand_landmarks_right:
            detected.append("R-hand")
        if landmarks.pose_landmarks:
            detected.append("pose")
        cv2.putText(frame, f"Detected: {', '.join(detected) or 'none'}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow("SignBuddy landmark extraction (press q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    extractor.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="0", help="Webcam index or video file path")
    args = parser.parse_args()
    source = int(args.source) if args.source.isdigit() else args.source
    _run_demo(source)
