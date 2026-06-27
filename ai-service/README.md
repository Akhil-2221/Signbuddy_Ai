# SignBuddy AI Service

## What's real here vs. what's mocked

**Real:**
- `pipeline/landmark_extractor.py` — actual MediaPipe Hands + Pose + Face Mesh wiring. This genuinely extracts hand/body/face keypoints from video frames.
- `app/main.py` — a real FastAPI server with real request/response contracts matching the backend's `aiServiceClient.js`.
- The interface contracts (`pipeline/interfaces.py`) — these define exactly what a real trained model must implement to plug in.

**Mocked (clearly marked `# MOCK` in code):**
- `pipeline/sign_classifier.py` — the actual sign → gloss classification. A real version needs a model trained on WLASL/ISL-CSLRT/BSL corpus data, which is a separate ML project (see `training/README.md` for the real training plan).
- `pipeline/speech_pipeline.py` — wraps Whisper for STT and a TTS engine; works with real models if you provide API keys, otherwise echoes back deterministic placeholder text so the rest of the system is testable end-to-end.

## Why mock instead of skip

The backend, frontend, database, and WebSocket layer all need a real AI service to talk to during development. The mock returns structurally correct responses (same shape, randomized-but-plausible confidence scores) so every other layer of the stack can be built, tested, and demoed honestly — with the AI quality itself clearly labeled as not-yet-trained.

## Swapping in a real model

1. Train a model per `training/README.md` (data collection, architecture, evaluation).
2. Implement `SignClassifier` interface in `pipeline/interfaces.py`.
3. Replace the import in `app/main.py` from `MockSignClassifier` to your real class. No other file changes needed.
