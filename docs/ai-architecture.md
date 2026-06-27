# SignBuddy AI — AI Architecture

## 1. Honest framing

This document describes two things that are easy to conflate but must stay separate:

1. **The AI pipeline architecture** — fully real, implemented, and runnable today (`ai-service/pipeline/landmark_extractor.py`, the FastAPI service, the client-side MediaPipe integration).
2. **The sign-recognition model itself** — not yet trained. `MockSignClassifier` stands in behind a stable interface (`SignClassifier`) so every other layer of the system can be built and tested honestly. See `ai-service/training/README.md` for the real path to a trained model.

## 2. Pipeline stages

```
Camera frame
    │
    ▼
[1] Hand/Pose/Face landmark extraction  ◄── REAL (MediaPipe, runs client-side in browser
    │                                         AND available server-side via landmark_extractor.py
    │                                         for batch/offline processing)
    ▼
[2] Landmark sequence buffering          ◄── REAL (frontend rolling buffer, ~0.8s batches)
    │
    ▼
[3] Sign classification                  ◄── MOCK today (interface real, model not trained)
    │   (CNN+LSTM or Transformer per
    │    training/README.md once trained)
    ▼
[4] Confidence scoring + thresholding    ◄── REAL (threshold logic, persisted, surfaced to UI)
    │
    ▼
[5] Text/speech output                   ◄── REAL (browser-native TTS, no mocking needed)
```

## 3. Why landmarks, not raw pixels

Training and serving on raw video pixels is both more data-hungry and more privacy-invasive than necessary. MediaPipe's hand/pose/face landmark models are already extremely well-trained on general human-body detection — SignBuddy doesn't need to re-solve "where is a hand in this image," only "what does this sequence of hand positions mean." Operating on the ~21-point hand skeleton (plus pose and a face-grammar subset) instead of pixels:

- Cuts the data a classification model needs to learn from drastically
- Keeps raw video off the wire and off disk entirely (privacy)
- Makes the eventual classifier lightweight enough to plausibly run on more modest hardware

This matches the approach in the cited literature (CNN-LSTM models trained on MediaPipe keypoints reporting ~98% accuracy on constrained ASL vocabularies).

## 4. Facial grammar capture

ASL/ISL/BSL grammar is not hand-shape-only — eyebrow position, mouth shape, and head tilt carry real grammatical meaning (e.g., distinguishing a question from a statement). `landmark_extractor.py` deliberately extracts a curated subset of MediaPipe's 468 face-mesh points (eyebrows + mouth corners) rather than either ignoring the face entirely or shipping all 468 points over the wire. This is a real architectural decision already implemented, independent of model training.

## 5. The model interface contract

```python
class SignClassifier(ABC):
    def classify_sequence(self, frames: list[LandmarkFrame], sign_language: str) -> RecognitionResult: ...
    def score_single_sign(self, frames: list[LandmarkFrame], target_gloss: str, sign_language: str) -> dict: ...
```

Any trained model — CNN+LSTM, Transformer, or something else entirely — becomes production-ready the moment it implements this interface. The FastAPI service (`app/main.py`) imports a single class; swapping `MockSignClassifier` for `TrainedSignClassifier` is a one-line change with zero downstream impact. This is the architectural decision that makes "build the whole product now, train the model later" a coherent plan rather than wishful thinking.

## 6. Speech direction (speech → text → sign)

- **Speech-to-text**: real Whisper integration is wired (`pipeline/speech_pipeline.py`), gated behind an `OPENAI_API_KEY`. Without a key configured, it returns a clearly-labeled mock response so the rest of the conversation flow remains testable.
- **Text-to-speech**: uses the browser's native `SpeechSynthesis` API directly — genuinely real, zero backend involvement, works the moment the page loads, no API key needed. This was a deliberate choice to avoid an unnecessary cloud dependency for a feature the browser already does well.
- **Speech recognition (alternative path)**: the browser's native `SpeechRecognition` API is used directly client-side for the "hearing person speaks" half of two-way conversation — again genuinely real and zero-latency-added by a server round trip, with an honest "not supported in this browser" fallback (notably Firefox lacks this API).

## 7. AI Tutor scoring

The practice-mode scoring path (`/v1/tutor/score`) reuses the exact same landmark pipeline as live recognition — a practice attempt and a live conversation utterance are structurally the same input. This is intentional: it means improvements to the trained classifier benefit both translation accuracy and tutor feedback quality simultaneously, with no separate tutor-specific model to maintain.

## 8. Continuous improvement loop

Every manual correction a user makes (`recognition_feedback` table) is captured with the original prediction and the corrected text. This is the raw material for:
- Identifying systematically confused sign pairs (informs targeted data collection)
- Eventually fine-tuning or retraining the classifier on real usage corrections, not just the original training corpus

This loop is wired end-to-end in the current codebase (frontend correction UI → backend persistence → `recognition_feedback` table) even though there's no automated retraining job yet — that's the natural next phase once enough corrections accumulate.

## 9. What a real model needs that this repo cannot provide

Per `ai-service/training/README.md`: GPU compute, labeled video corpora (WLASL for ASL; comparatively scarce sources for ISL/BSL), and weeks of training/evaluation iteration. This document describes the architecture that real model will plug into — not a claim that one exists yet.
