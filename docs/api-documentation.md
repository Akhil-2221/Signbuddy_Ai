# SignBuddy AI — API Documentation

Base URL (dev): `http://localhost:4000/api/v1`
All request/response bodies are JSON. Authenticated routes require `Authorization: Bearer <accessToken>`.

This document is hand-written against the actual route files in `backend/src/routes/` — if it ever drifts from the code, the code is the source of truth.

---

## Auth — `/auth`

### `POST /auth/register`
Create a permanent account.

```json
// Request
{ "email": "priya@example.com", "password": "min8chars", "fullName": "Priya R",
  "role": "deaf_user", "preferredSignLanguage": "ISL", "preferredSpokenLanguage": "te" }

// 201 Response
{ "user": { "id": "...", "email": "...", "fullName": "...", "role": "deaf_user", ... },
  "accessToken": "...", "refreshToken": "..." }
```
`409 user_exists` if email/phone already registered.

### `POST /auth/login`
```json
{ "identifier": "priya@example.com", "password": "min8chars" }
```
`401 invalid_credentials` on failure.

### `POST /auth/guest`
Creates a throwaway anonymous account — **no fields required**. This is how the app's onboarding screen works with zero signup friction (PRD FR10).
```json
// Request (optional)
{ "signLanguage": "ASL", "spokenLanguage": "en" }
// 201 Response — same shape as register/login
```

### `POST /auth/refresh`
```json
{ "refreshToken": "..." }
// 200 Response
{ "accessToken": "..." }
```

### `POST /auth/logout` 🔒
Revokes all refresh tokens for the current user. `204 No Content`.

### `GET /auth/me` 🔒
Returns the current user object.

---

## Sessions — `/sessions` 🔒 (all routes require auth, including guest tokens)

### `POST /sessions`
Start a translation session.
```json
{ "mode": "sign_to_text", "signLanguage": "ASL", "outputLanguage": "en", "deviceType": "mobile" }
// mode: sign_to_text | sign_to_speech | speech_to_text | two_way | emergency
```

### `POST /sessions/:sessionId/end`
Closes the session and computes `avg_confidence` across its utterances.

### `POST /sessions/recognize/sign`
REST path for sign recognition (batch/lower-frequency use — the WebSocket channel below is preferred for continuous live signing).
```json
{ "sessionId": "...", "signLanguage": "ASL", "sequenceIndex": 0, "frames": [ /* LandmarkFrame[] */ ] }
// 200 Response
{ "utterance": { "id": "...", "recognized_text": "HELLO", "confidence_score": 0.91, "low_confidence_flag": false, ... },
  "fallbackSuggested": false }
```

### `POST /sessions/recognize/speech`
```json
{ "sessionId": "...", "audioBase64": "...", "languageHint": "en", "sequenceIndex": 0 }
```

### `POST /sessions/translate`
Translates an already-recognized utterance's text into another language.
```json
{ "utteranceId": "...", "text": "HELLO", "sourceLang": "en", "targetLang": "hi" }
```

### `PATCH /sessions/utterances/:utteranceId/correct`
User manually corrects a recognized result. Also writes a row to `recognition_feedback` for the model-improvement loop.
```json
{ "correctedText": "Hello there" }
```

### `GET /sessions/:sessionId/history`
Returns the session plus all its utterances, ordered.

### `GET /sessions?limit=20`
Lists the current user's past sessions (used by the History screen).

---

## Real-time recognition — WebSocket

```
ws://localhost:4000/ws/recognize?token=<accessToken>
```

**Client → Server:**
```json
{ "type": "frame_batch", "sessionId": "...", "signLanguage": "ASL", "sequenceIndex": 3, "frames": [ /* LandmarkFrame[] */ ] }
```

**Server → Client:**
```json
{ "type": "recognition_result", "utterance": { ... }, "fallbackSuggested": false }
// or
{ "type": "error", "message": "Recognition failed, please retry" }
```

This is the production path for continuous live signing — see `docs/system-architecture.md` §3 for why both REST and WS exist.

---

## Tutor / Learning — `/tutor`

### `GET /tutor/lessons?signLanguage=ASL` — public
### `GET /tutor/lessons/:lessonId` — public
Returns the lesson plus its full sign list (joined from `sign_dictionary`).

### `GET /tutor/progress` 🔒
### `POST /tutor/practice` 🔒
```json
{ "signId": "...", "signLanguage": "ASL", "frames": [ /* LandmarkFrame[] */ ], "lessonId": "..." }
// 200 Response
{ "attempt": { ... }, "result": { "predictedGloss": "HELLO", "confidence": 0.83, "isCorrect": true } }
```

### `POST /tutor/lessons/:lessonId/complete` 🔒
### `GET /tutor/recommendations?signLanguage=ASL` 🔒
Returns `{ nextLesson, reviewLessons }` — see `tutorController.js::getRecommendations` for the current heuristic (next incomplete lesson by order, plus any lesson scored under 70%).

---

## Emergency phrases — `/emergency-phrases` — **public, no auth**

### `GET /emergency-phrases?signLanguage=ASL`
Intentionally has no auth requirement — a person in crisis must never hit a login wall (PRD FR13/FR17).
```json
{ "phrases": [
  { "id": "...", "phrase_key": "need_ambulance", "display_text_en": "I need an ambulance",
    "translations": { "hi": "मुझे एम्बुलेंस चाहिए", "es": "Necesito una ambulancia" }, "priority_order": 1 }
] }
```

---

## Dictionary — `/dictionary`

### `GET /dictionary?signLanguage=ASL&category=greetings&search=hello`
### `GET /dictionary/categories?signLanguage=ASL`

---

## User settings — `/users` 🔒

### `PATCH /users/settings`
Partial update — only send fields you're changing; accessibility settings are merged, not replaced.
```json
{ "preferredOutput": "both",
  "accessibilitySettings": { "darkMode": true, "textSize": "large" } }
```

---

## Error shape (all endpoints)

```json
{ "error": "validation_error", "message": "Human-readable description", "details": { /* optional, e.g. zod flatten() output */ } }
```

Common error codes: `validation_error` (400), `missing_token`/`invalid_token` (401), `forbidden` (403), `*_not_found` (404), `user_exists` (409), `internal_error` (500).

---

## Health

### `GET /health` — public
```json
{ "status": "ok", "aiService": "healthy", "timestamp": "..." }
```
