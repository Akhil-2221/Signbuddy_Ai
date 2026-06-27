# SignBuddy AI — Testing Strategy

## 1. What's actually tested in this repo today

Being precise about this matters more than aspirational test pyramids. As of this build:

| Layer | What exists | Where |
|---|---|---|
| Backend | Real integration tests (Jest + Supertest) against a real Postgres test DB | `backend/src/__tests__/auth.test.js`, `public-endpoints.test.js` |
| AI service | Real API tests (pytest + FastAPI TestClient) | `ai-service/tests/test_api.py` |
| Frontend | Manual static verification only (see §4) — no automated test suite yet | n/a |
| Database schema | Validated for syntax/balance; exercised indirectly via backend integration tests | `database/migrations/001_init_schema.sql` |

## 2. Backend testing approach

**Why integration tests over heavy mocking:** the backend's value is almost entirely in its SQL queries and the contracts between routes, middleware, and the database. Mocking the database would test very little of actual value. Instead, `auth.test.js` and `public-endpoints.test.js` run against a real Postgres instance (spun up as a GitHub Actions service container in CI, or any local Postgres for local runs), exercising the full request → controller → SQL → response path.

Covered today:
- Guest session creation (anonymous account flow)
- Registration, duplicate-rejection, login success/failure
- Token-gated route rejection without a valid JWT
- Public no-auth routes (emergency phrases, dictionary) actually requiring no auth
- Health check

**Explicitly not yet covered** (honest gap list, not hidden):
- Session/utterance recognition endpoints (would need either a running AI service or a mocked `aiServiceClient` — straightforward to add, just not done in this pass)
- WebSocket recognition flow
- Tutor/lesson progress endpoints
- Rate limiting behavior under load

## 3. AI service testing approach

`ai-service/tests/test_api.py` uses FastAPI's `TestClient` against the real app — no network, no separate server process needed, fast and deterministic. Tests assert the **contract shape** (response has `confidence` between 0 and 1, `lowConfidence` is boolean, etc.) rather than specific recognition output, since the classifier is currently a mock by design — testing for specific mock outputs would create false confidence and break the moment a real model is swapped in. This is intentional: the tests validate the interface, not the (not-yet-existing) intelligence.

**Once a real model is trained** (`ai-service/training/README.md`), the test suite should grow a second category: model-quality tests against a held-out evaluation set, run separately from the fast API contract tests (likely a separate CI job, since model evaluation is slower and needs GPU or at least real inference time).

## 4. Frontend verification approach (and why it's not automated yet)

This build could not run `npm install`/`next build` inside the development sandbox (no network access to the npm registry). Verification was done through:
1. Manual review of every component, hook, and page file
2. **Automated static cross-checks** written as throwaway Python scripts during development: every `@/...` import resolves to a real file; every named import matches an actual named export; every default import target has a default export
3. Tracing every frontend API call against the actual backend route files to confirm method, path, and payload shape match exactly

**Recommended next step**: once `npm install` runs in a real environment, add:
- `next build` to CI (already wired into `ci.yml`'s `frontend-build` job — it just hasn't run successfully yet because this build environment lacks registry access)
- Component tests with React Testing Library for the stateful pieces (`CameraView`, `LiveCaptionPanel` correction flow, `useRecognitionSocket`)
- A Playwright/Cypress smoke test for the guest-onboarding → translate flow, since that's the single most important path in the product

## 5. Manual QA checklist (for human testers, pre-launch)

Given the accessibility-first nature of this product, automated tests cannot fully substitute for human verification of:
- Screen reader behavior on every screen (VoiceOver + TalkBack at minimum)
- Actual camera/microphone permission flows on real iOS Safari and Android Chrome (these behave differently from desktop browsers in ways no test environment fully replicates)
- Text scaling at the maximum (1.45×) setting doesn't break any layout
- High contrast + dark mode combined doesn't produce any unreadable text/background pairs
- The emergency screen's 3-tap-or-fewer requirement, timed with a stopwatch, by someone unfamiliar with the app

## 6. Why no end-to-end ML accuracy testing exists yet

Evaluating sign-recognition accuracy requires a trained model and a held-out labeled test set — neither exists yet (see `ai-service/training/README.md`). Writing accuracy tests against the mock classifier would test the random number generator, not the product. This category of testing is correctly sequenced *after* model training, not before.
