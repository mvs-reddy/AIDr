/**
 * Clinical guardrails (spec §11, §27, §30).
 *
 * Two gates run around every AI call:
 *   preflight(input)   — before anything leaves the device
 *   validate(output)   — before anything is rendered
 *
 * Both are pure and synchronous so they can be unit-tested exhaustively against
 * the adversarial evaluation set in `__tests__/safety`.
 */

import type { AIWorkflowOutput, SafetyTier } from '../models';

export const SAFETY_POLICY_VERSION = '2026.07-1';

export const DISCLAIMER =
  'General health information, not medical advice. AIDr. does not diagnose, treat or prescribe. Always consult a qualified professional.';

// ─── Emergency routing ───────────────────────────────────────────────────────

/**
 * Phrases that must stop ordinary coaching and show emergency guidance.
 * Deliberately high-recall: a false positive costs one dismissible banner,
 * a false negative costs far more. Localised sets live in `i18n/safety.*.ts`.
 */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\bcrushing\s+chest\s+(pain|pressure)\b/i,
  /\bchest\s+(pain|pressure|tightness)\b.*\b(arm|jaw|sweat|breath)\b/i,
  /\b(can'?t|cannot|unable to)\s+breathe\b/i,
  /\bstruggling to breathe\b/i,
  // "face is drooping", "arm has drooped", "face droop" — a fixed adjacency here
  // would miss the way people actually write it.
  /\b(face|arm|speech|mouth|eyelid)\b[^.!?\n]{0,16}?droop/i,
  /\bdroop(?:ing|ed)?\b[^.!?\n]{0,16}?\b(face|arm|mouth|one side)\b/i,
  /\bslurred speech\b/i,
  /\b(sudden|suddenly)\b[^.!?\n]{0,24}?\b(weakness|numbness|paralysis)\b/i,
  /\b(weak|numb|numbness)\b[^.!?\n]{0,20}?\bone side\b/i,
  /\bworst headache of my life\b/i,
  /\bcoughing up blood\b/i,
  /\bvomiting blood\b/i,
  /\bunconscious\b|\bpassed out\b|\bfainted\b/i,
  /\bseizure\b/i,
  /\banaphyla/i,
  /\bthroat (is )?closing\b/i,
  /\boverdose\b|\btook too (many|much)\b/i,
  /\bsuicid|\bkill myself\b|\bend my life\b|\bself[- ]harm\b/i,
];

export type EmergencyKind = 'medical' | 'mentalHealth' | null;

export function detectEmergency(text: string): EmergencyKind {
  if (!text) return null;
  const mental = /\bsuicid|\bkill myself\b|\bend my life\b|\bself[- ]harm\b|\bwant to die\b/i;
  if (mental.test(text)) return 'mentalHealth';
  return EMERGENCY_PATTERNS.some((p) => p.test(text)) ? 'medical' : null;
}

export const EMERGENCY_COPY: Record<'medical' | 'mentalHealth', { title: string; body: string }> = {
  medical: {
    title: 'This may need urgent care',
    body:
      'What you described can be a medical emergency. Contact your local emergency number or go to the nearest emergency department now. AIDr. has paused this workflow and has not sent anything.',
  },
  mentalHealth: {
    title: 'Support is available right now',
    body:
      'You matter, and you do not have to handle this alone. Please contact your local crisis line or emergency services, or reach out to someone you trust. AIDr. has paused this workflow and has not sent anything.',
  },
};

// ─── Prohibited output claims ────────────────────────────────────────────────

export type Violation =
  | 'diagnosis'
  | 'prescribing'
  | 'doseChange'
  | 'emergencyDismissal'
  | 'unsupportedClaim'
  | 'missingEvidence'
  | 'missingDisclaimer';

const DIAGNOSIS_PATTERNS = [
  /\byou (have|are suffering from|are diagnosed with)\b/i,
  // `(?:\w+[\s-]+){0,3}` lets a modifier sit between the article and the noun —
  // "indicates a thyroid disorder" must be caught, not just "indicates a disorder".
  /\bthis (is|confirms|indicates|suggests|points to) (a |an )?(?:\w+[\s-]+){0,3}(diagnosis|disease|disorder|condition|syndrome|deficiency)\b/i,
  // "You're" and "You are" both, hence the optional apostrophe form.
  /\byou(?:'re| are|r results are) (?:likely |probably |clearly )?(diabetic|hypertensive|anaemic|anemic|pre[-\s]?diabetic|hypothyroid|hyperthyroid)\b/i,
];

const PRESCRIBING_PATTERNS = [
  /\b(start|begin|stop|discontinue|switch|substitute) (taking )?(your |the )?\w*\s*(medication|medicine|drug|tablet|dose)\b/i,
  /\byou should take\b.*\b(mg|mcg|ml|units?)\b/i,
  /\bI recommend (a|an|the) (dose|dosage) of\b/i,
];

const DOSE_CHANGE_PATTERNS = [
  /\b(double|triple|halve|increase|decrease|reduce|skip) (your |the )?(dose|dosage)\b/i,
  /\btake (two|2|an extra|another) (tablet|pill|capsule|dose)\b/i,
  /\bmake up (for )?the missed dose\b/i,
  /\btaper (down|off) (by|to)\b/i,
];

const EMERGENCY_DISMISSAL_PATTERNS = [
  /\b(nothing|no need) to worry about\b/i,
  /\bthis is (probably |likely )?(harmless|benign|nothing serious)\b/i,
  /\byou (do not|don'?t) need (to see|medical) (a doctor|attention|care)\b/i,
  /\bno need to (see|contact|call) (a |your )?(doctor|clinician|emergency)\b/i,
];

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  /** Human-readable, safe to show. Never contains raw provider errors. */
  message: string | null;
}

/**
 * Gate 2. Runs on the parsed, schema-valid output before render.
 * Any violation forces a bounded regenerate with a corrective system note; a
 * second failure surfaces a safe fallback rather than the model's text.
 */
export function validateOutput(output: AIWorkflowOutput): ValidationResult {
  const violations: Violation[] = [];
  const prose = [
    output.headline,
    ...output.summary,
    ...output.observations.map((o) => o.statement),
    ...output.questionsForClinician,
    ...output.uncertainties,
  ].join('\n');

  if (DIAGNOSIS_PATTERNS.some((p) => p.test(prose))) violations.push('diagnosis');
  if (PRESCRIBING_PATTERNS.some((p) => p.test(prose))) violations.push('prescribing');
  if (DOSE_CHANGE_PATTERNS.some((p) => p.test(prose))) violations.push('doseChange');
  if (EMERGENCY_DISMISSAL_PATTERNS.some((p) => p.test(prose))) violations.push('emergencyDismissal');

  // §18.1 — every observation rendered as fact needs at least one evidence ref.
  if (output.observations.some((o) => !o.evidenceRefs || o.evidenceRefs.length === 0)) {
    violations.push('missingEvidence');
  }
  if (!output.disclaimer || output.disclaimer.trim().length < 20) {
    violations.push('missingDisclaimer');
  }

  return {
    ok: violations.length === 0,
    violations,
    message: violations.length
      ? 'AIDr. blocked this response because it crossed a clinical boundary. Nothing was saved. You can retry, or rephrase what you want to understand.'
      : null,
  };
}

/** Regenerate instruction appended to the system prompt after a failed gate. */
export function correctionNote(violations: Violation[]): string {
  const notes: Record<Violation, string> = {
    diagnosis: 'Remove all diagnostic claims. Describe observations and pose questions instead.',
    prescribing: 'Remove all instructions to start, stop or change any medicine.',
    doseChange: 'Remove all dose or timing changes. Quote stored instructions only.',
    emergencyDismissal: 'Never reassure the user that a symptom is harmless or that care is unnecessary.',
    unsupportedClaim: 'Remove any statement not traceable to a supplied evidence reference.',
    missingEvidence: 'Every observation must include at least one evidenceRef from the supplied context.',
    missingDisclaimer: 'Include the exact disclaimer string supplied in the system prompt.',
  };
  return `Your previous response was rejected. Fix all of the following, then return valid JSON only:\n- ${violations
    .map((v) => notes[v])
    .join('\n- ')}`;
}

// ─── Recommendation language policy (spec §24.2) ─────────────────────────────

const BANNED_RECOMMENDATION_OPENERS = [
  /^you have\b/i,
  /\bthis will (treat|cure|fix)\b/i,
  /\byou should change your (prescribed|prescription)\b/i,
];

export function recommendationLanguageOK(text: string): boolean {
  return !BANNED_RECOMMENDATION_OPENERS.some((p) => p.test(text.trim()));
}

export function tierFor(flags: string[]): SafetyTier {
  if (flags.includes('emergencyLanguage')) return 'urgentSafety';
  if (
    flags.includes('clinicianRestriction') ||
    flags.includes('medicationFoodConflict') ||
    flags.includes('allergyConflict')
  ) {
    return 'discussWithClinician';
  }
  return 'generalWellness';
}
