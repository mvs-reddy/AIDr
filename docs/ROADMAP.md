# Delivery roadmap

Phase gates are exit criteria, not estimates. A phase is not done when the code
compiles; it is done when its gate passes.

## Status of this build

| Area | State |
| --- | --- |
| Design system, tokens, theme, primitives | Complete |
| Navigation shell, floating tab bar | Complete |
| Home, Journal, Settings | Complete |
| Four workflows via one spec-driven screen | Complete |
| Onboarding, 7 steps | Complete |
| New note, run result, AI account | Complete |
| Consent + redaction review sheets | Complete |
| Redaction service, pattern layer | Complete |
| Baseline engine | Complete |
| Safety policy, output schema, runner gates | Complete |
| HealthKit + Health Connect adapters | Complete, needs device testing |
| Document import, OCR, lab parser | Complete |
| Medication scheduler, conflict resolver | Complete |
| Recommendation engine | Complete |
| Clinician PDF export | Complete |
| Persistence, migrations, deletion | Complete |
| Safety / privacy / unit tests | Complete |
| **Native: `AIDrRedaction`** | Interface only |
| **Native: `AIDrPdf`** | Interface only |
| **Native: backup exclusion** | Not started — launch blocker |
| Medication + Diet screens | Not started |
| Lab timeline, metric detail, follow-up chat | Not started |
| Daily-read generation task | Not started |
| Widgets, Watch, Siri, Shortcuts | Not started |
| Locale translation | Structure only |

## Phases

**P0 — Foundation.** Design system, database, keystore, logging policy, safety
policy. *Gate: security and architecture review passed.* — done in this build.

**P1 — Core app.** Home, health integration, journal, four workflows, local
redaction, provider adapter. *Gate: end-to-end private workflow beta on both
platforms.* — code complete; needs the three native modules and device testing.

**P2 — Labs and conversation.** PDF/photo import, lab timeline, follow-up chat,
personal baselines. *Gate: parser validated against a real report corpus;
evidence-linked responses.* — parser and baselines done; timeline and chat open.

**P3 — Daily intelligence.** Morning/midday/evening/weekly reads, notifications,
widgets. *Gate: reliable schedules, clear consent.* — scheduler done, generation
task open.

**P4 — Sharing.** Clinician PDF, QR and link, exports and revoke. *Gate: threat
model and privacy review passed.* — export done, backend link service open.

**P5 — Ecosystem.** Watch, Siri, Shortcuts, Live Activities, multilingual
accessibility. *Gate: store production readiness.*

**P6 — Advanced privacy.** Optional local model packs, private audit traces,
expanded providers. *Gate: independent privacy and safety assessment.*

## Feature releases (spec §31)

| Release | Scope | Exit gate |
| --- | --- | --- |
| R1 | Wellness assets: coach, sleep, activity, stress, habits | Evidence-linked output; safety-language review |
| R2 | Nutrition: profile, logging, suggestions, grocery, weekly report | Allergy and restriction conflict tests pass |
| R3 | Medication manager: verified list, schedules, alerts, logs, refills | No autonomous dosing; notification reliability validated |
| R4 | Platform medications: import and reconcile | No duplicate reminders; source-of-truth tests pass |
| R5 | Cross-domain: unified engine, conflict resolver, clinician export | Medication-food and restriction conflict audit passed |
| R6 | Care circle: caregiver alerts, adherence sharing | Consent, revocation and privacy threat model passed |

## Immediate next work, in order

1. **Backup exclusion native module.** Privacy blocker. Small.
2. **`AIDrPdf`.** Unblocks the most common real-world import — a PDF lab report.
3. **`AIDrRedaction`.** Pattern-only redaction ships safely, but the clinical pack
   materially raises recall on clinic notes. Needs the §21 model decision first.
4. **Device testing matrix.** Real HealthKit and Health Connect data, partial
   grants, revocation mid-session, multi-source step counts.
5. **Medication and Diet screens.** Architecture and safety logic exist; these are
   presentation over settled domain code.
6. **Daily-read generation.** Background task feeding the Journal timeline.
7. **Lab timeline and metric detail.** Both read from data the parser and baseline
   engine already produce.
