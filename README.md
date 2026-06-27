<<<<<<< HEAD
# SignBuddy AI

Real-time sign language translation platform — bridging deaf and hearing communication.

## ⚠️ Honest scope of this codebase

This repo is a **real, runnable scaffold** for the full product: frontend, backend, database schema, and an AI service layer with a genuine MediaPipe hand-tracking pipeline. It is **not** a trained sign-language recognition model — that requires labeled video datasets (WLASL/ISL corpora), GPU training time, and iterative evaluation that can't happen inside a chat session. The AI service exposes a clean interface (`ai-service/pipeline/`) where a real trained model plugs in later without touching frontend or backend code.

Everything else — UI, API routes, auth, database, the hand-landmark extraction that runs live in the browser — is real and works once you install dependencies.

## Monorepo layout

```
signbuddy-ai/
├── frontend/        Next.js 14 + TypeScript + Tailwind — full UI
├── backend/         Node.js + Express API — auth, sessions, lessons, history
├── ai-service/       Python FastAPI — MediaPipe pipeline + model interface
├── database/         PostgreSQL schema + migrations + seeds
├── docs/             PRD, architecture, API spec, etc.
└── infra/            Docker + Kubernetes manifests
```

## Quick start (local dev)

```bash
# 1. Database
cd database && docker compose up -d

# 2. Backend
cd backend && npm install && npm run dev      # http://localhost:4000

# 3. AI service
cd ai-service && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000

# 4. Frontend
cd frontend && npm install && npm run dev     # http://localhost:3000
```

See `docs/` for the full PRD, architecture diagrams, and API documentation — start with [`docs/README.md`](./docs/README.md) for a guided reading order.

## What's real vs. mocked, in one paragraph

The full frontend, backend, database schema, WebSocket layer, MediaPipe hand-tracking, browser-native speech-to-text and text-to-speech are all real and functional. The sign-classification *model* (the part that turns hand landmarks into recognized words) is a clearly-labeled mock behind a stable interface — see [`ai-service/README.md`](./ai-service/README.md) and [`ai-service/training/README.md`](./ai-service/training/README.md) for exactly what's real, what's mocked, and the concrete path to training a real model.

## Tests

```bash
cd backend && npm test        # real Jest + Supertest integration tests against Postgres
cd ai-service && pytest -q    # real FastAPI TestClient tests
```

## Deployment

Local: `docker compose -f infra/docker/docker-compose.full.yml up --build`
Production: Kubernetes manifests in `infra/k8s/` — see [`docs/deployment-architecture.md`](./docs/deployment-architecture.md)
=======
# Signbuddy_Ai
It will convert signs to speech and text in real time, Very useful to deaf and dum people
>>>>>>> aea4d18337b7c3dd6e4e23fe3b50bd4d9b27b993
