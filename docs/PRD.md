# SignBuddy AI — Product Requirements Document

**Status:** v1.0 · **Owner:** Product · **Last updated:** 2026

---

## 1. Problem Statement

Deaf and hard-of-hearing individuals routinely lose access to services hearing people take for granted — explaining symptoms to a doctor, asking a question in a classroom, resolving a billing dispute, talking to a police officer — because a human interpreter isn't present and most hearing people don't sign. Existing solutions (on-call interpreter services, written notes, lip-reading) are slow, require scheduling, or place the burden of communication entirely on the deaf person.

## 2. Mission

Give a deaf person the same ability a hearing person has: walk up to anyone, communicate naturally, and be understood — without scheduling an interpreter, without typing on a phone, without a hearing person having to learn sign language first.

## 3. Goals (v1)

| Goal | Success looks like |
|---|---|
| Real-time sign → text/speech | A user signs a short phrase and sees/hears the translation within ~1–2 seconds |
| Real-time speech → text | A hearing person speaks and the deaf user sees readable text within ~1–2 seconds |
| Two-way conversation | Both directions work in the same session without switching screens |
| Works under real-world constraints | Usable one-handed, in poor lighting, on a 3-year-old Android phone |
| Zero-friction emergency access | A panicking user reaches a working emergency phrase screen in under 3 taps, no login required |
| Self-serve learning | A motivated hearing person or new signer can learn basic signs without a teacher |

## 4. Non-goals (v1)

- Translating full continuous ASL/ISL/BSL grammar with complete fidelity (this is a multi-year ML research problem — v1 targets isolated signs and short common phrases)
- Supporting sign languages beyond ASL/ISL/BSL
- Replacing professional human interpreters for legal, medical-diagnostic, or courtroom settings — SignBuddy should be positioned as a bridge for everyday communication, not a certified-interpreter substitute
- Offline full-sentence recognition (offline mode in v1 covers a small fixed phrase set only — see §8)

## 5. Primary user flows

See `docs/user-personas.md` for the people behind these flows.

1. **Sign → Text/Speech**: open app → start camera → sign → see captions, optionally hear speech
2. **Speech → Text**: hearing person taps "speak" → talks → deaf user reads the transcript
3. **Two-way conversation**: both directions live in one screen, turn by turn
4. **Emergency**: one tap from anywhere in the app → grid of urgent phrases → tap → spoken aloud instantly, no login required
5. **Learn**: browse lessons → watch reference sign → practice in front of camera → get pass/fail + confidence feedback

## 6. Functional requirements

### 6.1 Recognition & translation
- FR1: System detects hand landmarks continuously while the camera is active (real-time, client-side)
- FR2: System classifies a landmark sequence into recognized text via the backend AI service
- FR3: System shows a confidence score with every recognized utterance
- FR4: Below a confidence threshold (0.6), system flags the result as low-confidence and offers manual correction — never silently guesses
- FR5: User can manually correct any recognized text; corrections are persisted to the feedback loop for future model improvement
- FR6: System supports output as text only, speech only, or both, per user preference

### 6.2 Languages
- FR7: System supports ASL, ISL, BSL as input sign languages
- FR8: System supports 13 output spoken/written languages (see `frontend/src/types/index.ts::SPOKEN_LANGUAGES`)
- FR9: Adding a new sign language or output language requires no architecture change — only data/config additions (new dictionary entries, new locale mapping)

### 6.3 Accessibility
- FR10: No required login to use core translate, emergency, or browse-lesson flows — guest sessions work fully
- FR11: Text size, contrast, dark mode, and motion are user-controllable and persist across sessions
- FR12: Every interactive element has a minimum 44px tap target and visible focus ring
- FR13: Emergency phrases are reachable in ≤3 taps from any screen and require no authentication

### 6.4 Learning
- FR14: User can browse lessons by sign language and difficulty
- FR15: User can practice a sign in front of the camera and receive pass/fail + confidence feedback
- FR16: System tracks per-user lesson progress and recommends a "next lesson"

### 6.5 Emergency mode
- FR17: A fixed, pre-translated set of urgent phrases (ambulance, police, pain, interpreter, allergic reaction) is available offline-tolerant and spoken aloud on tap

## 7. Non-functional requirements

| Requirement | Target |
|---|---|
| Recognition latency (camera frame → result) | < 1.5s on mid-range mobile hardware (network-dependent; see Scalability Plan) |
| Uptime | 99.9% for backend API; AI service degrades gracefully (see Architecture §5) |
| Accessibility | WCAG 2.1 AA as a floor |
| Data retention | No raw video or audio is ever persisted — only derived text and landmark-summary metadata (see Security Plan) |
| Internationalization | All UI strings externalized for translation (v1 ships English UI; full UI localization is a fast-follow) |

## 8. Known v1 limitations (stated honestly)

- The shipped AI service uses a **mock classifier** — see `ai-service/README.md` and `ai-service/training/README.md` for the real model-training plan. This PRD describes the product as designed; the recognition quality itself depends entirely on a model that has not yet been trained.
- Offline mode covers only the fixed emergency phrase set and a small on-device demo vocabulary — not full offline sentence recognition.
- ISL has materially less public training data than ASL; expect ISL accuracy to lag ASL at launch unless additional data collection is funded.

## 9. Success metrics (post-launch)

- **Activation**: % of new sessions that complete at least one successful translation
- **Trust**: % of recognized utterances that are NOT manually corrected (proxy for real-world accuracy)
- **Retention**: 7-day and 30-day return rate among registered (non-guest) users
- **Emergency reliability**: time-to-first-spoken-phrase from emergency screen open (target: < 5 seconds)
- **Learning engagement**: lesson completion rate, practice attempts per active learner

## 10. Open questions for stakeholders

- Which institution type (hospital, school, government) should the first pilot target — accuracy bar and liability posture differ significantly by setting
- Data-sharing agreement structure for sourcing ISL training data from Indian deaf community organizations
- Whether a "human interpreter on standby" escalation path is needed for low-confidence high-stakes conversations (e.g., medical)
