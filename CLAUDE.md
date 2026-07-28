# CLAUDE.md — AIDr.

Working notes for any agent or engineer extending this codebase. Read this before
touching `src/`.

## What AIDr. is

A privacy-first personal health companion for iOS and Android. It turns
platform health data, imported documents and user notes into plain-language
summaries, personal-baseline observations and clinician-ready questions.

**AIDr. prepares conversations, not conclusions.** It is not a medical device. It
does not diagnose, treat or prescribe.

AIDr. is an independent product. Welna / OpenMed were studied only as a
competitive benchmark; no naming, copy, asset, prompt, policy or code is derived
from them. Do not introduce any.

## Non-negotiable invariants

These are not style preferences. Breaking one is a release blocker.

1. **Raw health records never leave the device.** `HealthAdapter.readSamples()`
   is local-only. Only `readSignals()` output — aggregated and baselined on
   device — may reach a prompt. If you find yourself importing `readSamples`
   anywhere near `services/ai/`, stop.
2. **No cloud request without a consent receipt and a completed redaction.**
   Both are produced inside `services/ai/runner.ts`. That file is the only place
   a `RedactedAIRequest` may be constructed.
3. **Every rendered observation cites real evidence.** `evidenceRefsResolve()`
   rejects a ref that was not in the supplied context. A hallucinated
   `signal:hrv:7d` for a user with no HRV authorisation fails the run.
4. **No silent model fallback.** If the served model differs from the requested
   one, abort and tell the user. See the mismatch guard in `OpenAIProvider`.
5. **AIDr. never authors a dose, schedule or taper.** `MedicationPlan.doseText`
   is quoted from a verified source. A plan with `verifiedAt === null` cannot
   generate a reminder — enforced in `scheduleForPlan()`.
6. **An unacknowledged reminder is `notLogged`, never `missed`.** Absence of a
   log is not evidence of a skipped dose.
7. **"Normal" / "abnormal" belong only to a laboratory's printed range.** For
   personal signals, use "above/below your usual range". Enforced in prompts and
   asserted in `__tests__/unit/baseline.test.ts`.
8. **Below the minimum-data gate, say so.** `computeBaseline()` returns `null`
   rather than a weak estimate. Never invent a trend.
9. **Nothing sensitive in logs, analytics, crash reports or backups.** No raw
   samples, no OCR text, no note bodies, no keys, no medicine names in
   notification previews.
10. **Colour never carries meaning alone.** Every status token pairs with a glyph
    or a label.

## Layout

```
src/
  app/                     expo-router file routes
    (tabs)/                Home · Journal · Settings
    workflow/[kind].tsx    one screen, four workflows, driven by domain/workflows.ts
    run/[id].tsx           result view
    note/new.tsx           journal entry
    onboarding/            7-step first run
    settings/              sub-screens
  components/              cross-feature composites (consent + redaction sheets)
  design-system/
    tokens.ts              colour, space, radius, type, motion — no raw hex elsewhere
    theme.tsx              light/dark/dark-style/accent resolution
    components/            Text · Surface · Controls · Feedback
  domain/                  PURE. no I/O, no React, no platform APIs
    models/                entities
    safety/                policy.ts (gates) · outputSchema.ts (zod)
    baselines/             robust statistics
    recommendations/       engine.ts · conflictResolver.ts
    workflows.ts           workflow specs
  services/                I/O lives here and only here
    health/                HealthAdapter + .ios / .android implementations
    redaction/             the single network chokepoint
    ai/                    provider, prompts, runner (state machine + gates)
    documents/             import, OCR, PDF pages, lab parser
    persistence/           SQLite, kv, secure store
    notifications/         medication scheduler, daily briefs
    export/                clinician PDF
    audit/                 privacy ledger, optional traces
  state/                   zustand stores (thin — logic belongs in domain/services)
  i18n/
  __tests__/               safety/ privacy/ unit/
```

**Dependency direction:** `app → components → design-system`, and
`app → state → services → domain`. `domain/` imports nothing from `services/` or
`app/`. If you need platform data in a domain function, pass it as an argument.

## Adding things

**A new workflow.** Add an entry to `domain/workflows.ts` and a brief to
`WORKFLOW_BRIEF` in `services/ai/prompts.ts`. Do not create a new screen —
`app/workflow/[kind].tsx` renders from the spec.

**A new health signal.** Add to `SignalType`, then to `QUANTITY`/`CATEGORY`
(iOS) and `RECORD` (Android), then to the relevant `SCOPE_SIGNALS` entry. Decide
its `aggregationFor()` and `dedupStrategy()`. If it needs more history before
statements are safe, add a `PER_SIGNAL` override in the baseline engine.

**A new recommendation.** Add a generator to `domain/recommendations/engine.ts`
returning `Candidate[]` with honest `traits`. The conflict resolver reads those
traits — a candidate that involves food or fasting and does not declare it will
bypass the allergy and medication-timing checks.

**A new redaction pattern.** Add to `PATTERNS` with a calibrated confidence.
Above 0.9 auto-redacts silently; 0.55–0.9 forces user review. When in doubt,
under-score it: a review prompt is cheap, a leak is not.

## Commands

```bash
npm install
npx expo prebuild --clean     # generates ios/ and android/
npm run ios                   # needs a dev client — HealthKit has no Expo Go support
npm run android
npm run typecheck
npm test
npm run test:safety           # must be green before any release
npm run test:privacy          # must be green before any release
```

`expo start` alone will not work for health features. HealthKit and Health
Connect both require a development build.

## Native modules to implement

Three bridges are declared and consumed but need native implementations. Each has
a documented interface and degrades safely when absent:

| Module | iOS | Android | Degrades to |
| --- | --- | --- | --- |
| `AIDrRedaction` | Core ML + `NLTagger` | TFLite + ML Kit | Pattern-only redaction |
| `AIDrPdf` | PDFKit rasterise | `PdfRenderer` | PDF import unavailable |
| Backup exclusion | `isExcludedFromBackup` resource value | `noBackupFilesDir` | Vault included in backup |

The third is a privacy requirement, not a nice-to-have — see docs/PRIVACY.md.

## Things that look like bugs but are not

- **Home shows `–` instead of a number.** Correct. The spec forbids a fabricated
  metric; an unavailable value renders as an empty ring with a dash.
- **A recommendation silently disappears.** The conflict resolver blocked it.
  Surface `CONFLICT_COPY[flag]` if the user asks why — do not "fix" it by
  downranking instead of blocking.
- **A run fails after a valid-looking response.** Gate C rejected it. Check
  `violations` in the runner. Loosening the gate is a clinical-safety change and
  needs review.
- **Locale files are empty.** Deliberate. English fallback is on, and `safety.*`
  keys must not be machine-translated.

## Open decisions (spec §21)

Answer these before a store submission:

- Which on-device redaction and clinical-NLP models are approved for production?
- Are organisation-managed AI accounts in scope, or user-account only?
- First-release countries, and the regulatory assessment applicable in each?
- Who hosts clinician share links — AIDr. backend or an approved third party?
- Retention and deletion policy for local runs, documents and exports?
- Which platform health metrics are approved for the first release?
- Are audit traces developer-only or user-facing?
