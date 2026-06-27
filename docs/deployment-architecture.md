# SignBuddy AI — Deployment Architecture

## 1. Environments

| Environment | Purpose | Infra |
|---|---|---|
| Local dev | Day-to-day development | `npm run dev` / `uvicorn --reload` directly + `database/docker-compose.yml` for Postgres only |
| Staging | Integration testing, demo | `infra/docker/docker-compose.full.yml` — full stack in containers |
| Production | Real traffic | Kubernetes (`infra/k8s/`), managed Postgres, real container registry |

## 2. Container images

Three images, built independently, versioned by git SHA:

| Image | Dockerfile | Base |
|---|---|---|
| `signbuddy/frontend` | `infra/docker/Dockerfile.frontend` | `node:20-alpine`, multi-stage, Next.js `standalone` output |
| `signbuddy/backend` | `infra/docker/Dockerfile.backend` | `node:20-alpine`, multi-stage, production deps only |
| `signbuddy/ai-service` | `infra/docker/Dockerfile.ai-service` | `python:3.11-slim` + OpenCV/MediaPipe system deps |

All three run as non-root users and ship a `HEALTHCHECK`. None bundle dev dependencies or test files into the runtime layer.

## 3. Production topology (Kubernetes)

See `infra/k8s/*.yaml`. Summary:

- **Namespace**: `signbuddy`, isolating all resources
- **Frontend**: 2 replicas, low resource footprint, served behind Ingress at `app.signbuddy.ai`
- **Backend**: 3 replicas minimum, HPA up to 15 on 65% CPU, served at `api.signbuddy.ai`
- **AI service**: 2 replicas minimum, HPA up to 10 on 70% CPU; resource requests sized for the current mock workload — **re-tune once a real GPU-bound model is deployed** (the manifest has a commented `nvidia.com/gpu` line ready for that point)
- **Postgres**: StatefulSet with a 20Gi PVC for dev/staging clusters; **production should use a managed database** (RDS/Aurora/Cloud SQL) instead — the manifest explicitly notes this tradeoff
- **Ingress**: TLS via cert-manager + Let's Encrypt, with extended proxy timeouts (3600s) specifically to support long-lived WebSocket recognition connections — the default nginx-ingress timeout would otherwise kill active signing sessions

## 4. Secrets management

`infra/k8s/00-namespace-config.yaml` ships a `Secret` manifest with placeholder `CHANGE_ME` values — **this is intentional and must never be committed with real values.** Production secrets (DB credentials, JWT signing keys, OPENAI_API_KEY) should be injected via:
- `kubectl create secret generic` at deploy time, or
- A proper secrets manager (AWS Secrets Manager / HashiCorp Vault) with an External Secrets Operator syncing into the cluster

JWT access and refresh secrets must be cryptographically random (not the example placeholders) and rotated on a defined schedule.

## 5. CI/CD pipeline

`.github/workflows/ci.yml` runs on every push/PR to `main`/`develop`:

1. **backend-test**: spins up a real Postgres service container, applies the schema, runs `npm run lint` and `npm test` (real Jest + Supertest integration tests against that DB)
2. **frontend-build**: lints and runs a full `next build`
3. **ai-service-test**: compiles all Python files, runs the real `pytest` suite against the FastAPI app
4. **docker-build** (main branch only, after the three test jobs pass): builds all three images to confirm they build cleanly

**What's intentionally left as a template:** the actual `docker push` to a registry and `kubectl apply`/`helm upgrade` deploy step. These require real cluster credentials and a provisioned container registry that don't exist until this project is actually deployed — wiring them in with placeholder credentials would be security theater, not a real pipeline.

## 6. Rollout strategy (recommended, not yet automated)

- **Backend/AI service**: rolling updates (Kubernetes default), readiness probes gate traffic cutover — a pod isn't sent traffic until `/health` passes
- **Database migrations**: should run as a separate Kubernetes `Job` before the backend rollout begins, never as a side effect of pod startup (avoids race conditions across multiple backend replicas starting simultaneously)
- **Frontend**: standard rolling update; since it's stateless and fast to start, blue/green isn't necessary at this scale

## 7. Observability (not yet implemented — documented as the next step)

The codebase ships structured JSON logging (`backend/src/utils/logger.js`, Winston) and `/health` endpoints on both backend and AI service, which are the prerequisites for:
- Log aggregation (e.g., CloudWatch/Datadog/Loki)
- Uptime monitoring hitting `/health` on a schedule
- APM tracing across the REST + WebSocket + AI service boundary, which would be especially valuable for diagnosing the recognition-latency budget described in `docs/system-architecture.md` §3

These are flagged as next steps rather than claimed as done — wiring a specific observability vendor is a deployment-environment decision, not a code architecture one.
