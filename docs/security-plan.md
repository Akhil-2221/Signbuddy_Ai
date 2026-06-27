# SignBuddy AI — Security Plan

## 1. Data classification

| Data | Classification | Handling |
|---|---|---|
| Raw camera video | **Never persisted, anywhere** | Processed entirely client-side by MediaPipe; only derived numeric landmark coordinates ever leave the device |
| Raw microphone audio | Sensitive, transient | Sent to AI service for transcription only when speech-to-text is invoked via the backend path; not written to disk; the primary STT path actually used by the frontend (`useSpeechToText`) runs natively in-browser and never transmits audio at all |
| Recognized text / utterances | Personal, persisted | Stored in `session_utterances` — this is conversation content and must be treated with the same sensitivity as chat logs |
| Landmark coordinates (hand/pose/face keypoints) | Low sensitivity but not zero | Numeric only, not visually reconstructible into a photo-quality image, but could theoretically reveal some biometric/gait-like signal — not stored long-term, only transient in request payloads |
| Account credentials | Highly sensitive | bcrypt-hashed (cost factor 12), never logged, never returned in any API response |
| Accessibility settings, language preferences | Personal, low sensitivity | Stored plainly in `users.accessibility_settings` JSONB |

**The single most important security property of this architecture**: raw video and audio are not in the data model at all — there is no table, no bucket, no field that stores them. This isn't a retention *policy* (i.e., "we delete it after 30 days") — it structurally never exists server-side in the first place. This is a stronger guarantee than a deletion policy and was a deliberate architectural choice (see `docs/system-architecture.md` §4).

## 2. Authentication & authorization

- **Password hashing**: bcrypt, 12 rounds (`backend/src/utils/auth.js`)
- **Tokens**: short-lived JWT access tokens (15 min default) + longer-lived refresh tokens (30 days), refresh tokens are themselves bcrypt-hashed before storage in `refresh_tokens` — a stolen database dump does not yield usable refresh tokens
- **Guest accounts**: real user rows with `is_anonymous = true`, same auth machinery as full accounts — this means guest sessions get the same token security properties, not a weaker side-door
- **Logout**: revokes all refresh tokens for the user (`revoked_at` timestamp), not just the current device's
- **Role-based access**: `requireRole()` middleware exists for admin/institution-scoped routes (not yet exercised by any current route, but the mechanism is in place for the institution-dashboard features implied by the PRD's "schools, hospitals, government" target customers)

## 3. Transport security

- All production traffic terminates TLS at the Ingress (`infra/k8s/04-frontend-ingress.yaml`, cert-manager + Let's Encrypt)
- WebSocket connections upgrade over the same TLS-terminated connection (`wss://`)
- CORS is explicitly restricted to the configured frontend origin (`CORS_ORIGIN` env var), not wildcard, in any environment where that variable is set

## 4. Input validation

Every backend route that accepts a body validates it with `zod` schemas before touching the database (see every controller in `backend/src/controllers/`) — malformed or unexpected fields are rejected with a structured `validation_error` response rather than silently coerced or passed through to SQL. All database queries use parameterized placeholders (`$1, $2...`), never string concatenation — there is no SQL injection surface in this codebase as written.

## 5. Rate limiting

Global rate limiting (`express-rate-limit`, default 120 req/min/IP) applies to all `/api/` routes. This is a basic first layer — production deployments serving real traffic should add:
- Tighter limits specifically on `/auth/login` and `/auth/register` to slow credential-stuffing/enumeration attempts
- IP + account-based limiting on the WebSocket connection rate, not just REST

These are flagged as hardening steps beyond the current global limiter, not yet implemented as separate tiers.

## 6. Secrets handling

See `docs/deployment-architecture.md` §4. No real secret values are committed to this repository — `.env.example` files contain only placeholder/empty values, and the Kubernetes secret manifest uses `CHANGE_ME` placeholders with an explicit comment instructing real values be injected separately.

## 7. Known gaps (stated honestly, not hidden)

- **No automated dependency vulnerability scanning** wired into CI yet (e.g., `npm audit` / `pip-audit` / Dependabot) — should be added before production launch
- **No Web Application Firewall (WAF)** configured at the Ingress level — recommended addition for production, especially given the product may handle data in healthcare-adjacent contexts (PRD §6 mentions hospital pilots)
- **No formal incident response plan** exists yet — needed before any institutional (hospital/school/government) pilot, given the sensitivity of the personas described in `docs/user-personas.md`
- **HIPAA/GDPR/DPDP compliance** has not been formally assessed. The architecture's "no raw video/audio persistence" property is a strong starting point, but formal compliance requires a legal/compliance review beyond what this engineering document can certify — flagged explicitly in `Executive_Summary.pdf`'s ethics section as well, and carried forward here rather than glossed over
- **No audit logging** of who accessed/corrected which conversation data — relevant for institutional deployments where accountability matters (e.g., a hospital wanting to know which staff member viewed a patient conversation)

## 8. Privacy-by-design summary

The architecture's strongest privacy property — never persisting raw video or audio — was a design decision made before any data-protection requirement forced it, specifically because the product's most vulnerable users (per `docs/user-personas.md`) are exactly the people who'd be most harmed by a video/audio data breach. This should remain a non-negotiable architectural invariant through any future iteration of this product, not something that gets "optimized away" later for a marginal accuracy gain from storing raw frames.
