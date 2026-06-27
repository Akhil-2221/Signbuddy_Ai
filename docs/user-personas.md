# SignBuddy AI — User Personas

## 1. Priya — Deaf college student (primary persona)

- **Age 20, Hyderabad.** Fluent in ISL, reads/writes English and Telugu comfortably.
- **Context:** Needs to ask professors questions, talk to shopkeepers, deal with bank staff. Currently relies on writing on her phone, which is slow and makes people impatient.
- **Needs:** Fast two-way conversation, ISL support specifically (most apps only do ASL), output in both Telugu and English depending on who she's talking to.
- **Frustration with status quo:** "People get impatient waiting for me to type. I want to just sign and have it spoken immediately."
- **Design implication:** Two-way mode must be fast enough that a hearing person doesn't lose patience; output language must be switchable per-conversation, not just per-account.

## 2. Robert — Father of a deaf child, hearing, learning ASL

- **Age 38, Chicago.** Hearing, has a 6-year-old deaf daughter. Taking ASL classes but still a beginner.
- **Context:** Wants to communicate better at home and understand his daughter's signing in real time while he's still learning.
- **Needs:** Sign → speech/text so he can understand his daughter even before his own ASL is fluent; the Learn module to study alongside her.
- **Frustration with status quo:** Interpreter apps assume the deaf person types or has high signing fluency the app can parse — his daughter's signing is still developing, and he needs something forgiving of imperfect signs.
- **Design implication:** Low-confidence fallback and manual correction matter even more here — the app should never silently produce a wrong "official" translation of a child's signing.

## 3. Dr. Chen — Emergency room physician

- **Age 45, hospital network, hearing.** Sees a deaf patient roughly once a month, never has a contracted interpreter immediately available.
- **Context:** Needs basic medical communication fast — "where does it hurt," "are you allergic to anything" — while waiting for a certified interpreter for anything beyond triage.
- **Needs:** Reliability over polish. Wants to trust the confidence score because a wrong answer in this setting has real consequences.
- **Frustration with status quo:** Calling an interpreter service can take 20+ minutes; in triage, that's too slow.
- **Design implication:** This persona is explicitly **not** v1's target for full reliance — SignBuddy should be positioned to him as a bridge until a certified interpreter arrives, never as a diagnostic-grade communication tool. The PRD's non-goals reflect this.

## 4. Amara — Deaf jobseeker in an emergency situation

- **Age 27, London, BSL fluent.** Was in a minor traffic incident and needs to communicate urgently with responding police/paramedics who don't sign.
- **Context:** High stress, may not have logged into any app, phone may have low battery or be a borrowed device.
- **Needs:** Get to "I need an ambulance" / "I'm in pain" spoken aloud in under 5 seconds, no login wall, no learning curve.
- **Frustration with status quo:** Most communication apps assume a calm setup process — useless in a crisis.
- **Design implication:** This is the persona behind Emergency Mode's no-auth, ≤3-tap design requirement (PRD FR13, FR17).

## 5. Marcus — Hearing customer service rep

- **Age 24, retail, hearing, knows zero sign language.** Occasionally serves deaf customers and wants to help without making them feel like a burden.
- **Context:** Doesn't own the app or have an account — a deaf customer hands him their phone or shows him a screen.
- **Needs:** Understand what's being signed without needing to install anything or sign up himself.
- **Design implication:** The Translate and Conversation screens must work entirely from the deaf user's device and account — a hearing bystander should never need their own login to participate in a conversation.

---

These personas are referenced throughout `docs/PRD.md` and should be revisited after the first round of real user interviews — they are reasoned starting hypotheses, not validated research.
