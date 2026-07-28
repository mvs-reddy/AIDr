# Privacy and security

The design rule, from spec §9.1: **import locally, extract locally, redact
locally, consent explicitly, send minimally, persist locally.**

## The boundary

```
   ┌──────────────────────── THIS DEVICE ────────────────────────┐
   │                                                             │
   │  HealthKit / Health Connect ──► normalize ──► baselines      │
   │       (raw samples)              (on device)                 │
   │            │                                                 │
   │            └── never crosses ──┐                             │
   │                                 │                            │
   │  Camera / Files ──► OCR ──► classify ──► lab rows            │
   │       (originals stay in vault)  │                           │
   │                                 │                            │
   │  Notes (raw words) ─────────────┤                            │
   │                                 ▼                            │
   │                        RedactionService                      │
   │                                 │                            │
   │                    ┌────────────┴────────────┐               │
   │                    │  uncertain? → user review│              │
   │                    └────────────┬────────────┘               │
   │                                 ▼                            │
   │                          Consent receipt                     │
   │                                 │                            │
   └─────────────────────────────────┼────────────────────────────┘
                                     ▼
                      redacted text + NormalizedSignal[]
                                     │
                                     ▼
                          user's own AI account
```

What crosses, exhaustively:

- Redacted free text, with `[NAME_1]`-style placeholders.
- `NormalizedSignal` objects: type, period, aggregate, unit, personal baseline,
  deviation, confidence, ref.
- Locale, model name, safety policy version, consent receipt id.

What never crosses: raw samples, sample timestamps, device or bundle names,
original files, OCR text, note bodies, first name, API keys, HealthKit metadata,
medicine names in any analytics or generic wellness prompt.

## Redaction

`services/redaction/RedactionService.ts` is the only chokepoint.

**Two engines.** A deterministic pattern layer always runs — 20+ classes covering
names, dates, addresses, UK postcodes, US ZIP+4, NHS numbers, MRN/UHID, Aadhaar,
SSN, insurance and account numbers, phones, emails, URLs, device serials, and the
HIPAA safe-harbour rule that ages over 89 must be generalised. An optional
on-device clinical NER pack (~40 MB) raises recall on free-form clinical prose.
The pack is a strengthener, never a gate.

**Confidence tiers.** ≥0.90 auto-redacts. 0.55–0.90 forces user review and blocks
the send. Below 0.55 is discarded as noise. Calibrate new patterns conservatively:
a review prompt costs a tap, a leak cannot be undone.

**Names get three tiers, and the pattern floor must stand alone.** Person names
are the highest-value PHI class, so they cannot depend on an optional 40 MB
download that a user may decline:

| Evidence available | Confidence | Behaviour |
| --- | --- | --- |
| Explicitly labelled — `Patient: Sarah Mills` | 0.97 | Auto-removed |
| Adjacent to an identifier cue — a name immediately before a DOB, record number or age | 0.94 | Auto-removed |
| Line-initial `Firstname Lastname,` with nothing else to go on | 0.72 | Sent to review |

The third tier is deliberately not auto. The same shape also matches a lab row
like `Blood Pressure, 120/80`, and silently deleting a result is its own kind of
harm — so the user sees it and decides. The privacy suite asserts each tier
separately, and runs at the pattern-only floor precisely because that is what
ships to someone who skips the pack.

**Cue labels survive.** A pattern with a capture group redacts only the group, so
`Patient: Sarah Mills` becomes `Patient: [NAME_1]`. Replacing the whole match
would strip the label, leaving a clinician reading the export unable to tell what
the placeholder stood for.

**Span offsets.** Every span carries character offsets, so the review sheet can
show the original with removals struck through, and so placeholders can be
reversed for on-screen display.

**Session-only reversibility.** The placeholder→original map lives in memory,
never on disk. `dispose()` is called on run completion and on any app-state
change away from active.

**Follow-ups too.** Spec §9.2: redact every message, not only the first. Any
conversation turn goes through the same service.

## Credentials

`expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Deliberately *not*
`requireAuthentication` — a biometric prompt during a background daily-read
refresh fails silently and reads as a bug. The at-rest class is strict and
iCloud sync is off, so a restored backup on a new device does not carry the key.

Secrets are read at request time and never enter Zustand state, a log line, a
crash report or an audit trace. `maskSecret()` produces the display form.

## Backup exclusion

Required, and currently the one gap needing native work:

- **iOS** — set `isExcludedFromBackup` on the SQLite directory and the document
  vault.
- **Android** — place the vault in `noBackupFilesDir` and set
  `android:allowBackup="false"` or a `data_extraction_rules` exclusion.

Without this, an iCloud or Drive restore on another device carries raw OCR text
and note bodies. Treat it as a launch blocker.

## The privacy ledger

Every run appends one row: timestamp, workflow, categories used, destination
(`onDevice` or `cloudProvider`), redaction engine, span count, and a SHA-256 of
the payload.

The hash matters. It lets a user verify what was sent without AIDr. keeping a
second copy of the thing it is auditing — and it is what the run detail screen
shows as a "payload fingerprint".

## Analytics

Off by default. When on: screens viewed, feature counters, crash counts. Never
free text, metric values, document names, medicine names or any stable health
identifier. No advertising identifiers, no cross-app tracking.

## Notifications

No health detail in any preview, on either platform. Medication reminders default
to "A dose is due" with the name withheld; Android uses
`VISIBILITY_PRIVATE` for medication and `VISIBILITY_SECRET` for briefs. The user
can opt into names, and that choice is explicit.

## Sharing

High-entropy token (256 bits), expiring, revocable. Only the token *hash* is
stored locally, so a compromised device database cannot reconstruct a live link.

The copy states plainly that revocation stops future access and cannot retract a
file or screenshot someone already saved. Do not soften that.

## Play and App Store posture

- Declare every Health Connect permission in Play Console with its exact
  user-facing feature. No speculative scopes for unbuilt features.
- Health data is never used for advertising, insurance eligibility, employment
  decisions or unauthorised social sharing.
- Prominent privacy policy, data-deletion path, account disconnection.
- Consent version, permission scope and purpose recorded per cloud run.
