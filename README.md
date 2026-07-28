# AIDr.

A privacy-first personal health companion for iOS and Android. It reads the
health data you authorise, redacts identifiers on your device, and helps you turn
your own numbers into questions worth asking your clinician.

**AIDr. prepares conversations, not conclusions.** It is not a medical device and
does not diagnose, treat or prescribe.

---

## Quick start

```bash
npm install
npx expo prebuild --clean      # generates ios/ and android/
npm run ios                    # or: npm run android
```

A development build is required. HealthKit and Health Connect are both
unavailable in Expo Go, so `expo start` alone will not exercise the health path.

```bash
npm run typecheck
npm test
npm run test:safety            # release gate
npm run test:privacy           # release gate
```

## What is here

| Path | Contents |
| --- | --- |
| `src/app/` | Screens (expo-router): tabs, workflows, run detail, note, onboarding |
| `src/design-system/` | Tokens, theme, primitives — no raw hex outside `tokens.ts` |
| `src/domain/` | Pure logic: models, safety gates, baselines, recommendations |
| `src/services/` | All I/O: health, redaction, AI, documents, persistence, notifications, export, audit |
| `src/state/` | Three thin Zustand stores |
| `src/__tests__/` | `safety/` · `privacy/` · `unit/` |
| `docs/` | Architecture, privacy, safety, integrations, roadmap |
| `CLAUDE.md` | Working notes and invariants — read before editing |

## Design

Warm cream canvas, deep green-black ink, and one of four user-selectable accents
(Clay, Sage, Amber, Rose) with three dark styles. Newsreader for display,
Inter for body. The signature treatment is a serif headline where a single word
carries the accent in italic — *"Prepare for your visit."* — implemented as
`DisplayTitle` so translators keep control of word order rather than the app
parsing markup.

Every status token pairs with a glyph, because colour alone never carries meaning.
Type scales with Dynamic Type and clamps per element so a long headline cannot
push a sticky CTA off screen.

## Ten invariants

Breaking one is a release blocker, not a code-review note.

1. Raw health records never leave the device.
2. No cloud request without a consent receipt and a completed redaction.
3. Every rendered observation cites evidence that actually exists.
4. No silent model fallback.
5. AIDr. never authors a dose, schedule or taper.
6. An unacknowledged reminder is `notLogged`, never `missed`.
7. "Normal" belongs only to a lab's printed range.
8. Below the minimum-data gate, say so — never invent a trend.
9. Nothing sensitive in logs, analytics, crash reports or backups.
10. Colour never carries meaning alone.

## Known gaps

Three native modules are declared and consumed but need implementations. Each
degrades safely when absent, and one is a launch blocker:

| Module | Degrades to | Priority |
| --- | --- | --- |
| Backup exclusion | Vault included in device backup | **Launch blocker** |
| `AIDrPdf` | PDF import unavailable | High |
| `AIDrRedaction` | Pattern-only redaction | Needs the model-approval decision first |

See `docs/ROADMAP.md` for the full status table and the ordered next steps.

## Independence

AIDr. is an independent product. Welna and OpenMed were studied only as a
competitive benchmark for privacy-first health UX. No naming, copy, asset, prompt,
policy, data contract or code is derived from them, and none should be introduced.

## Licence

Proprietary. Confidential working repository.
