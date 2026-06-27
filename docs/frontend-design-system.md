# SignBuddy AI — Frontend Design System

## 1. Design thesis

SignBuddy's primary user is a person who may be stressed, in an unfamiliar setting, or actively trying to communicate something urgent in real time. The design brief from the start was explicit: **never make the interface itself something a deaf user has to struggle with.** Every design decision below traces back to that constraint, not to visual trend-chasing.

This rules out a lot of "interesting" design moves. No dense information architecture, no subtle low-contrast UI chrome, no gestural/hidden navigation, no decorative animation competing for attention with the one thing that matters: the camera and the caption. The visual personality of this product is *calm competence* — it should feel like a steady hand, not a flashy demo.

## 2. Color

| Token | Hex | Use |
|---|---|---|
| `signal` (primary) | `#0E7C7B` deep teal | Primary actions, active states, trust anchor |
| `signal-600` | `#0B6362` | Hover/pressed state |
| `urgent` | `#D14B3D` warm coral-red | **Reserved exclusively for Emergency mode and destructive actions** |
| `ink-900` | `#0E1E1F` | Primary text (light mode) |
| `canvas` | `#FAFAF8` | Page background (light mode) |
| `canvas-dark` | `#10181A` | Page background (dark mode) |

**Why teal, not the typical AI-product blue/purple gradient:** teal reads as calm and clinical-adjacent without being cold — appropriate for a tool that may be used in medical and emergency settings, while staying distinct from the generic "AI startup" blue-to-purple gradient. The coral-red `urgent` token is deliberately used *nowhere else* in the product — not for warnings, not for accents — so that when a user sees it, it means exactly one thing: emergency. Color carries semantic weight precisely because it isn't decoratively overused elsewhere (see `tailwind.config.js` comments).

## 3. Typography

- **Display**: Sora (600–800 weight) — used for headlines, sign glosses, and lesson titles. Geometric but warm, legible at a glance.
- **Body**: Inter (400–700 weight) — used for everything else. Chosen for its exceptional legibility at small sizes and wide language support (matters for the 13 output languages, several non-Latin scripts).
- **Base size**: 16px minimum, never smaller, and user-adjustable up to 1.45× via the Text Size setting (`globals.css` `--text-scale` variable, four steps: small/medium/large/extra_large).

## 4. The signature element

The **live confidence indicator** (`ConfidenceIndicator.tsx`) is the one piece of UI this product should be remembered by. Most translation/captioning tools either hide their uncertainty entirely (dangerous — false confidence) or expose a raw percentage that reads as cold and alarming. SignBuddy's bar uses a calm three-state traffic-light gradient (teal → amber → coral) with the percentage alongside, paired with a non-alarming, specific message ("Not fully sure about this one. You can correct it below.") rather than a generic warning icon. This single component embodies the product's core value: honest about uncertainty, never condescending or alarming about it.

## 5. Layout & navigation

- **Bottom tab navigation** (`BottomNav.tsx`) — five fixed destinations (Translate, Talk, Emergency, Learn, Settings), always reachable, Emergency always rendered in the `urgent` color regardless of active state so it's spottable at a glance even when not focused.
- **Single-column, full-width content** on mobile; no sidebar, no nested menus. The product has five real destinations — it does not need information-architecture sophistication it doesn't have content to justify.
- **Camera view is always the visual anchor** on Translate, Conversation, and Lesson-practice screens — large, 4:5 aspect on mobile widening to 16:9 on larger viewports, never competing for space with secondary content.

## 6. Component inventory

| Component | Purpose |
|---|---|
| `BigButton` | The only button component in the app — large, high-contrast, consistent across all four variants (primary/secondary/urgent/ghost). Consistency reduces cognitive load far more than visual variety would for this audience. |
| `CameraView` | Camera feed + live MediaPipe hand-detection overlay (green pulse dot = real detection signal, not decorative) |
| `LiveCaptionPanel` | Recognized text + confidence + speak/correct actions |
| `ConfidenceIndicator` | The signature element (§4) |
| `OutputModeToggle` | Text / Speech / Both segmented control |
| `ScreenHeader` | Back button + title, used on every non-tab-root screen |
| `BottomNav` | Persistent 5-tab navigation |

## 7. Accessibility implementation (not just intent)

These aren't aspirational — they're implemented in `globals.css` and `AccessibilityProvider.tsx` today:

- **Text size**: CSS custom property scaling (`--text-scale`), four steps, applied at the `<html>` root so it cascades everywhere including third-party-feeling components
- **High contrast**: `data-high-contrast` attribute toggles a `.hc-border` utility class to stronger 2px borders sitewide
- **Dark mode**: class-based (`html.dark`), respects user toggle, not just OS preference
- **Reduced motion**: respects both `prefers-reduced-motion` media query AND an explicit in-app toggle (some users want reduced motion without changing OS-wide settings)
- **Focus visibility**: a global `:focus-visible` outline is defined once and never overridden — no component is allowed to silently remove it
- **Minimum tap targets**: 44px minimum height enforced globally on `button` and `a[role="button"]`

## 8. Motion

Used in exactly two places, both meaningful rather than decorative:
- The hand-detection pulse dot in `CameraView` (signals genuine live detection state)
- The emergency phrase's pulse ring while speaking (`animate-pulseRing`, signals "this is currently being read aloud")

No page-load animations, no scroll-triggered reveals, no hover micro-interactions beyond simple color/scale transitions on buttons. This is a deliberate restraint choice, not an oversight — see Design Principles in `/mnt/skills/public/frontend-design/SKILL.md`: "sometimes less is more, and extra animation contributes to the feeling that the design is AI-generated." For an accessibility-first product specifically, restraint is also a usability requirement, not just an aesthetic one.
