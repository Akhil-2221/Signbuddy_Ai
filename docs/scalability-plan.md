# SignBuddy AI — Scalability Plan

## 1. Where the real bottleneck will be

Once a trained model replaces `MockSignClassifier`, the AI service — not the backend or database — becomes the binding constraint. A CNN+LSTM or Transformer doing real-time sequence classification is GPU-bound and has fundamentally different latency/throughput characteristics than the Express API or Postgres queries. The architecture (`docs/system-architecture.md`) already separates the AI service as an independently-scaled deployment specifically because of this anticipated shift — it is not premature optimization, it's sequencing the one piece of infra work that's actually hard to retrofit later (splitting a monolith's inference logic out under load is much more painful than starting split).

## 2. Scaling each tier

### Frontend
Stateless, served from CDN-cacheable static assets after `next build`. Scales horizontally trivially; not expected to be a bottleneck at any realistic scale. `infra/k8s/04-frontend-ingress.yaml` runs 2 replicas as a baseline — bump for traffic, not for capacity reasons specifically.

### Backend (Node/Express)
Stateless except for the duration of an open WebSocket connection. HPA configured for 3–15 replicas on 65% CPU (`infra/k8s/03-backend.yaml`). The main scaling consideration specific to this service: **WebSocket connections are sticky to a pod for their duration** — Kubernetes Services load-balance new connections round-robin, but an existing connection stays on its pod until it closes or the pod is recycled. At high concurrent-session scale, this means connection count (not just CPU) becomes a relevant capacity signal worth adding to the HPA metrics — flagged as a future refinement once real concurrent-session data exists.

### AI service
The piece most likely to need real scaling work:
- **Horizontal**: already configured for 2–10 replicas (`infra/k8s/02-ai-service.yaml`)
- **Vertical/hardware**: the manifest has a commented `nvidia.com/gpu: 1` resource line ready to uncomment once a real model needs GPU inference — the mock classifier today runs fine on CPU, so this is deliberately not enabled yet (avoids paying for GPU nodes the current code doesn't use)
- **Batching**: a real production classifier should batch concurrent inference requests where possible rather than processing one landmark sequence at a time — this is a model-serving optimization (e.g., via a proper serving framework like TorchServe or Triton) that should be designed in alongside the trained model itself, not bolted on after

### Database
- Vertical scaling (bigger managed Postgres instance) is the right first lever — premature horizontal sharding for a product at this stage would be over-engineering
- Read replicas are a natural next step once read-heavy endpoints (lesson browsing, dictionary search, history) show meaningful load separate from write-heavy paths (session/utterance inserts)
- The schema is already reasonably normalized with appropriate indexes on hot paths (`idx_sessions_user`, `idx_utterances_session`, `idx_usage_events_type_time`, etc. — see `database/migrations/001_init_schema.sql`)

## 3. Capacity planning unknowns (stated honestly)

Real capacity numbers (requests/sec the AI service can serve per GPU, expected concurrent-session count at launch, peak-vs-average traffic ratio for an accessibility tool used in bursts around specific events like doctor visits) **cannot be estimated meaningfully before a real trained model exists and the product has real usage data.** Any specific number given here would be a guess dressed up as an estimate. The right next step is: ship a real model, instrument the AI service's actual per-request latency and throughput under load testing, and revisit this document with real numbers.

## 4. Geographic/multi-region considerations

Not addressed in v1 infrastructure — `infra/k8s/` describes a single-region deployment. Given the product's target users (per `docs/user-personas.md`, spanning India, UK, US), latency-sensitive real-time recognition would eventually benefit from regional AI-service deployments closer to users, with the backend/database remaining centralized or following a hub-and-spoke pattern. This is appropriately deferred — solving multi-region infrastructure before validating product-market fit in a single region would be premature.

## 5. Cost considerations

The AI service's GPU costs (once a real model is deployed) will likely dominate infrastructure spend at any meaningful scale — far more than the backend, frontend, or database combined. This should inform a key product decision not yet made: whether to run inference per-request (simple, but pays for idle GPU capacity) or move toward a serverless/batched inference model (more complex, but better cost efficiency for a product with naturally bursty usage patterns — most users aren't signing continuously 24/7). This tradeoff is flagged here as a decision for whoever owns the trained-model deployment, not resolved in this document.
