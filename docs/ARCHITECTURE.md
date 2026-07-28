# Architecture

## Why cross-platform

The spec (§6) recommends native Swift/SwiftUI, written when the target was
iPhone-only. The Google Health addendum then added full Android parity with
Health Connect, Wear OS and Play policy requirements. That changes the
calculation: two native codebases would mean writing the safety spine — redaction
gates, consent receipts, output validation, baseline maths, conflict rules —
twice, and keeping two copies of a clinical-safety boundary in sync.

This build uses **Expo + React Native with the new architecture**, and pushes
platform-specific work behind three seams:

| Seam | iOS | Android |
| --- | --- | --- |
| `HealthAdapter` | HealthKit | Health Connect |
| `AIDrRedaction` | Core ML + `NLTagger` | TFLite + ML Kit |
| `AIDrPdf` | PDFKit | `PdfRenderer` |

Everything else — including every safety-critical path — is written once and
tested once.

The trade-off is real: HealthKit's newest APIs land in Swift first, and a native
app would get medication records the day Apple ships them. The mitigation is that
`HealthAdapter` is a narrow interface, so a Swift module can be dropped behind it
per-signal without touching feature code.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│ app/            expo-router screens                     │
│ components/     cross-feature composites                │
│ design-system/  tokens · theme · primitives             │
├─────────────────────────────────────────────────────────┤
│ state/          zustand — thin, no business logic       │
├─────────────────────────────────────────────────────────┤
│ services/       ALL I/O: health, redaction, ai,         │
│                 documents, persistence, notifications,  │
│                 export, audit                           │
├─────────────────────────────────────────────────────────┤
│ domain/         PURE: models, safety, baselines,         │
│                 recommendations, workflow specs          │
└─────────────────────────────────────────────────────────┘
```

`domain/` has no imports from `services/` or `app/`. That is what makes the
safety suite fast and exhaustive — `validateOutput`, `computeBaseline` and
`resolveConflicts` are synchronous pure functions that can be hammered with
hundreds of adversarial cases in milliseconds.

## The run state machine

`services/ai/runner.ts` is the single path from user input to rendered result.
Spec §10.1 defines the states; the runner adds three gates.

```
collectingInput
      │
      ▼
┌─────────────┐   Gate A — emergency screen on RAW LOCAL text.
│  detect     │   Runs before redaction, before consent, before any
│  emergency  │   network setup. Emergency → cancelled, nothing sent.
└─────────────┘
      │
      ▼
   redacting ──────► requiresReview? ──► user edits ──► re-redact
      │                                                     │
      ▼◄────────────────────────────────────────────────────┘
┌─────────────┐   Gate B — consent receipt. The receipt records policy
│ awaiting    │   version, provider, model, scope and purpose. No
│ Consent     │   receipt → no RedactedAIRequest can be constructed.
└─────────────┘
      │
      ▼
 buildingContext ──► requestingAI ──► validatingOutput
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                    ┌──────────────────┐          presentingResult
                    │ Gate C — schema  │                  │
                    │ + evidence refs  │                  ▼
                    │ + clinical rules │                saved
                    └──────────────────┘
                              │
                    one corrective retry,
                    then fail with safe copy
```

Gate A runs on raw text rather than redacted text on purpose. Redaction can
remove context an emergency classifier needs — a date, a name in "I found Dad
unconscious" — so the screen happens first, locally, and its result never leaves
the device either.

## Data flow for one Visit Prep run

1. `HealthConnectAdapter.readSignals('visitPrep', 90)` reads records, resolves
   overlapping sources by priority, collapses to daily values, computes a
   median/MAD baseline per signal, and returns `NormalizedSignal[]`. Raw samples
   are discarded inside the adapter and never enter app state.
2. The workflow screen collects optional fields, focus tags and documents.
3. `executeRun()` screens for emergency language, redacts, and — if any span is
   uncertain — shows the review sheet with the original struck through and an
   editable payload.
4. The consent sheet names the model, the exact signal types, the character count
   and the redaction engine.
5. `buildSystemPrompt` / `buildUserPrompt` assemble the payload. The user prompt
   lists the exact evidence refs the model is permitted to cite.
6. The provider streams. A model mismatch aborts under the no-fallback policy.
7. `parseWorkflowOutput` (zod) → `evidenceRefsResolve` → `validateOutput`.
8. The run is saved locally with a payload hash. The privacy ledger already has
   its row from step 5.

## Persistence

SQLite via `expo-sqlite`, WAL mode, foreign keys on. Migrations are an
append-only array with `PRAGMA user_version` tracking, because health data is
longitudinal — a migration that drops a column drops years of someone's history.

Three storage tiers, chosen by sensitivity:

| Tier | Contents | Mechanism |
| --- | --- | --- |
| Secure | API keys, session tokens, share signing key | Keychain / Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, never iCloud-synced |
| Protected | Runs, notes, documents, labs, medication, privacy log | SQLite + file protection, excluded from backup |
| Plain | Theme, accent, locale, reminder times, sync anchors | kv store |

Deletion is per-category plus a full reset. `deleteCategory('documents')` also
clears the file vault, because a row without its file is not deletion.

## State management

Zustand, deliberately thin. Three stores:

- `settingsStore` — persisted preferences. Nothing sensitive.
- `healthStore` — connection state and normalized signals. Observable from Home,
  every workflow and Settings, which §22 called out as a platform requirement.
- `runStore` — the single active run plus history. One run at a time by design:
  concurrent cloud calls would make a consent receipt ambiguous about which
  payload it authorised.

Business logic does not live in stores. A store that starts computing baselines
or deciding safety tiers is a refactor signal.

## Offline behaviour

| Condition | Behaviour |
| --- | --- |
| No network | Daily reads from cached signals, full journal, document import, OCR, medication reminders, lab timeline all work. Cloud workflows explain they need connectivity and preserve input. |
| Health permission denied | Manual and document workflows run. No repeat permission prompts. |
| Model unavailable | Under no-fallback, stop with a configuration action. Never substitute. |
| App killed mid-run | Resumable state persists; unredacted transient payloads are not written to disk. |
| Redaction uncertain | Cloud send blocked until the user confirms or edits. |
