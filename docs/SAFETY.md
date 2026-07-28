# Clinical safety

AIDr. sits deliberately inside the FDA's enforcement-discretion space: it tracks
information and provides user-configured reminders. The moment a feature makes a
patient-specific treatment recommendation, it leaves that space and needs its own
regulatory and clinical review.

## Hard boundaries

AIDr. must never:

- Name a condition the user has, or rank differential diagnoses.
- Tell anyone to start, stop, switch, combine, increase, decrease, double or skip
  a medicine or dose.
- Author a dose, a schedule or a taper.
- Say a symptom is harmless, or that professional care is unnecessary.
- Invent a trend, a number, a reference range or a date.
- Use "normal" / "abnormal" for a personal signal. That vocabulary belongs only to
  a laboratory's printed range.
- Contact emergency services automatically.

## The three gates

**Gate A — emergency screen.** `detectEmergency()` runs on raw local text before
redaction or consent. Tuned for high recall across cardiac, stroke, respiratory,
anaphylaxis, overdose and crisis language, with mental-health routing separated
from medical. A hit cancels the run, shows the banner, and sends nothing. A false
positive costs one dismissible banner; a false negative costs far more.

**Gate B — consent.** No receipt, no request. Enforced structurally: only the
runner can construct a `RedactedAIRequest`, and it does so after the receipt.

**Gate C — output validation.** In order: zod schema → evidence refs resolve
against the supplied context → clinical pattern rules. Any failure triggers one
corrective regenerate with a specific instruction; a second failure discards the
response and shows safe copy. The model's own text never reaches the screen on a
failed gate, and neither does a raw provider error, which can echo the prompt.

## Language policy

| Use | Not |
| --- | --- |
| "above your usual range" | "high" |
| "You may consider…" | "You should…" |
| "Based on your recent pattern…" | "This means you have…" |
| "Worth asking your clinician about…" | "This will treat…" |
| "not enough information yet" | a confident number from thin data |

Enforced in three places: the prompt contract, `recommendationLanguageOK()`, and
the `validateOutput` patterns.

## Medication

The whole module rests on one distinction: **AIDr. reminds, it does not decide.**

- `doseText` is quoted verbatim from a verified source. Never composed.
- A plan with `verifiedAt === null` cannot schedule a reminder.
- OCR from a label scan is provisional until the user confirms every field.
- Missed-dose flow shows the stored instruction, or advises contacting a
  pharmacist when none exists. It never generates catch-up guidance.
- Taper schedules are transcribed from verified instructions and can never be
  AI-generated.
- An unacknowledged reminder is `notLogged`. Reminder delivery and user logging
  are measured separately, so a missing log is never read as non-adherence.
- Schedule conflicts, duplicate imports and time-zone shifts are surfaced for
  review. AIDr. never reschedules autonomously.
- Caregiver escalation only for user-marked critical medicines, only with
  explicit per-person consent.

## Nutrition tiers

| Tier | Allowed | Example |
| --- | --- | --- |
| A — general wellness | Broad healthy-eating education | "More vegetables, more variety" |
| B — personalised wellness | Adapt general guidance to preferences and routine | Meal timing that fits their schedule |
| C — clinician-directed | Digitise a plan a professional entered | Renal, diabetic, pregnancy, post-op |
| Prohibited | Creating or modifying a therapeutic diet from AI inference | Any unsupervised electrolyte, renal, insulin or severe-restriction plan |

Allergy and clinician-restriction checks run before every meal recommendation.
Photo recognition stays provisional until confirmed. The diet report never shows
body-shaming language, moral labels, or scores that could trigger disordered
eating.

## Conflict resolution

Wellness, nutrition and medication guidance run through one engine so they cannot
contradict each other. Priority order:

- **P0 Safety** — emergency guidance, allergies, verified medication instructions
- **P1 Clinician plan** — recorded restrictions override generic AI advice
- **P2 Consent** — only authorised data and enabled categories
- **P3 Evidence** — official, current, jurisdiction-relevant guidance
- **P4 Personal fit** — culture, budget, ability, schedule
- **P5 Engagement** — convenience and adherence, last

P0 and P1 conflicts *block* a candidate. They never merely downrank it: a
suppressed suggestion that resurfaces on a quiet day is the same defect,
delayed.

## Localised safety copy

`safety.*` keys must not be machine-translated or added to a locale file until a
clinical reviewer fluent in that language has signed them off. A mistranslated
emergency instruction is a safety defect. English fallback is on, so a locale
shipping without `safety.*` is safe; a locale shipping with unreviewed `safety.*`
is not.

## Evaluation sets

The adversarial suite must cover: pregnancy, paediatrics, older adults,
renal/hepatic restriction, eating disorders, polypharmacy, and emergency
symptoms. `npm run test:safety` and `npm run test:privacy` are release gates.
