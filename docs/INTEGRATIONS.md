# Health platform integrations

## Choice of layer

| Scenario | API |
| --- | --- |
| iOS / watchOS | HealthKit |
| Android / Wear OS | Health Connect |
| Fitbit cloud history not present on device | Google Health API, after explicit account linking |
| Legacy Google Fit customer | Compatibility adapter plus migration plan only |

Health Connect — not a Google Fit-first implementation — is the Android layer.
Fit may appear as a *contributing source inside* Health Connect, which is exactly
why source resolution matters.

## Just-in-time, minimum scope

Permissions are requested per `FeatureScope`, at the moment the user enables the
feature, never as a launch-time blanket grant.

```
dailyReads     steps, activeEnergy, restingHeartRate, sleepDuration
visitPrep      + weight, blood pressure
sleepRecovery  sleep, RHR, HRV, respiratory rate, SpO2, skin temperature
activity       steps, distance, energy, exercise, floors, gait
body           weight, body fat, lean mass, BMR
metabolic      glucose, blood pressure, body temperature
nutrition      hydration, nutrition  (+ write, opt-in)
cycle          menstruation  (explicit opt-in only)
```

Read and write are separate. AIDr. defaults to read-only. Write is requested in
exactly two places: hydration/nutrition publish-back after a user confirms a meal,
and a dose event after the user taps Taken.

A partial grant is a normal state, not an error. Missing records never imply a
negative health event.

## Source resolution and deduplication

The failure this prevents: one walk written by a Pixel Watch, Fitbit, Samsung
Health and the phone's own sensor. Summing gives 4× the real step count.

- Interval-style signals (steps, distance, energy, exercise, floors, sleep,
  hydration) use the **highest-priority source** covering each day.
- Clinical observations (blood pressure, glucose, body temperature, weight) are
  **kept per record**, each with its source and timestamp. Two readings are two
  facts, not a value to average.
- Records are never merged unless type, interval, values and source relationship
  satisfy a tested rule.
- Detail views name the contributing source.

Priority defaults to watch → phone → third party, and the user can reorder it in
Settings › Connected sources.

## Incremental sync

- **Health Connect** — change tokens via `getChangesToken` / `getChanges`. An
  expired token falls back to a full window read rather than silently missing
  data.
- **HealthKit** — anchored object queries; the anchor persists in the kv store.

## Availability

Health Connect requires Android 9 (API 28) and a runtime availability check.
Three outcomes, each with its own copy: available; provider update required
(deep-link to Play); unsupported (explain that AIDr. still works with manual
entries and documents).

**AIDr. must install and function with no health source at all.** That is an
acceptance criterion, not a graceful-degradation nicety.

## Medication records

- Platform medication data can populate the list and intake history where
  available.
- Every imported medicine passes a confirmation screen: name, strength, form,
  dose, frequency, start/end, prescriber instructions.
- One source of truth per medicine — platform, AIDr. local schedule, or a
  clinician-imported plan. Prevents duplicate reminders.
- Reconciliation uses stable identifiers plus explicit user confirmation.
- Dose events are written only after Taken, a notification action, or an
  authorised wearable action.
- Medication data is excluded from analytics and from generic wellness prompts.

## Required UI surfaces

| Screen | Addition |
| --- | --- |
| Home | Connect-health card, sync-status badge |
| Settings | Permissions, connected sources, last sync, read/write state, disconnect, deep-link to the OS data-management screen |
| Onboarding | Apple Health on iOS, Health Connect on Android — resolved automatically |
| Medication | Import records, confirm schedule, choose whether dose events write back |
| Diet | Nutrition and hydration permissions with a separate write-back switch |
| Privacy log | Per-category: used in which workflow, stayed local or summarised for cloud |

## Acceptance criteria

- Installs and functions without any health platform.
- No permission requested until the corresponding feature is enabled.
- Raw records cannot reach an AI provider.
- Duplicate step totals are not double-counted.
- Revoking a permission immediately stops future reads for that type.
- Write-back only from a confirmed user action.
- Medical, cycle, medication and symptom scopes pass minimum-scope review.
- Health data never appears in crash reports, analytics or notification previews.
