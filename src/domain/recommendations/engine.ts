/**
 * Unified recommendation engine (spec §28).
 *
 * Wellness, nutrition and medication guidance all funnel through here so they
 * cannot contradict each other. The canonical failure this prevents: a fasting
 * or "skip breakfast" suggestion firing for someone whose verified label says
 * "take with food in the morning".
 *
 * Pipeline (§28):
 *   1 collect context → 2 resolve medication + clinician restrictions →
 *   3 generate candidates → 4 contraindication/conflict rules →
 *   5 score evidence + relevance → 6 safety tier + language →
 *   7 select non-conflicting set → 8 rationale + confidence →
 *   9 capture feedback → 10 re-evaluate on change
 */

import type {
  WellnessRecommendation, WellnessCategory, NormalizedSignal, NutritionProfile,
  MedicationPlan, Medication, SafetyFlag, Confidence, EvidenceRef,
} from '../models';
import { recommendationLanguageOK, tierFor } from '../safety/policy';
import { describeDeviation } from '../baselines/personalBaseline';
import { resolveConflicts, type ConflictContext } from './conflictResolver';

export const RECOMMENDATION_POLICY_VERSION = '2026.07-1';

/** §24.2 — never more than three on the home surface, to avoid alert fatigue. */
export const MAX_HOME_RECOMMENDATIONS = 3;

export interface RecommendationContext {
  signals: NormalizedSignal[];
  nutrition: NutritionProfile | null;
  plans: Array<MedicationPlan & { medication: Medication }>;
  /** Categories the user has actually enabled. P2 gate. */
  enabledCategories: WellnessCategory[];
  /** Recent adherence rate per plan, 0–1. */
  adherence: Record<string, number>;
  now: Date;
  locale: string;
}

export interface Candidate {
  category: WellnessCategory;
  title: string;
  action: string;
  rationale: string;
  evidenceRefs: EvidenceRef[];
  confidence: Confidence;
  effort: 'trivial' | 'light' | 'moderate';
  /** Base merit before personal fit and safety adjustments. */
  expectedBenefit: number;
  /** Structured description used by the conflict resolver. */
  traits: {
    involvesFasting?: boolean;
    involvesHydration?: boolean;
    involvesFood?: string[];
    shiftsMealTime?: boolean;
    involvesIntenseActivity?: boolean;
    involvesSleepTiming?: boolean;
  };
}

export function generate(ctx: RecommendationContext): WellnessRecommendation[] {
  // 1–2 — context and restrictions are resolved by the caller and passed in.
  const conflictCtx: ConflictContext = {
    plans: ctx.plans,
    nutrition: ctx.nutrition,
    now: ctx.now,
  };

  // 3 — candidates
  const candidates = [
    ...sleepCandidates(ctx),
    ...activityCandidates(ctx),
    ...recoveryCandidates(ctx),
    ...hydrationCandidates(ctx),
    ...adherenceCandidates(ctx),
  ]
    // P2 — only enabled categories
    .filter((c) => ctx.enabledCategories.includes(c.category));

  // 4–6 — conflicts, scoring, tier
  const scored = candidates
    .map((c) => {
      const flags = resolveConflicts(c, conflictCtx);
      return { candidate: c, flags, score: score(c, flags, ctx) };
    })
    // A hard block (allergy, verified food instruction) removes the candidate
    // entirely rather than downranking it — P0 outranks everything.
    .filter(({ flags }) => !flags.some(isHardBlock))
    .filter(({ candidate }) => recommendationLanguageOK(candidate.action))
    .sort((a, b) => b.score - a.score);

  // 7 — select a small non-conflicting set: at most one per category
  const chosen: typeof scored = [];
  const usedCategories = new Set<WellnessCategory>();
  for (const item of scored) {
    if (usedCategories.has(item.candidate.category)) continue;
    usedCategories.add(item.candidate.category);
    chosen.push(item);
    if (chosen.length >= MAX_HOME_RECOMMENDATIONS) break;
  }

  // 8 — materialise with rationale, confidence and expiry
  return chosen.map(({ candidate, flags }) => ({
    id: `${candidate.category}:${hash(candidate.title)}:${ctx.now.toISOString().slice(0, 10)}`,
    category: candidate.category,
    title: candidate.title,
    action: candidate.action,
    rationale: candidate.rationale,
    evidenceRefs: candidate.evidenceRefs,
    confidence: candidate.confidence,
    effort: candidate.effort,
    validUntil: endOfDay(ctx.now).toISOString(),
    contraindicationFlags: flags,
    safetyTier: tierFor(flags),
    sourcePolicyVersion: RECOMMENDATION_POLICY_VERSION,
    aiGenerated: false, // deterministic engine; AI copy is layered separately
    feedback: 'none',
  }));
}

function isHardBlock(flag: SafetyFlag): boolean {
  return flag === 'allergyConflict' || flag === 'medicationFoodConflict' || flag === 'clinicianRestriction';
}

/** 5 — evidence quality × personal relevance × effort, then safety adjustment. */
function score(c: Candidate, flags: SafetyFlag[], ctx: RecommendationContext): number {
  const evidenceWeight = c.evidenceRefs.some((r) => r.kind === 'guideline') ? 1.0 : 0.8;
  const confidenceWeight = { high: 1.0, medium: 0.75, low: 0.45 }[c.confidence];
  const effortWeight = { trivial: 1.0, light: 0.9, moderate: 0.7 }[c.effort];
  const coveragePenalty = flags.includes('lowDataCoverage') ? 0.4 : 1;
  return c.expectedBenefit * evidenceWeight * confidenceWeight * effortWeight * coveragePenalty;
}

// ─── Candidate generators ────────────────────────────────────────────────────

const WHO_DIET: EvidenceRef = {
  ref: 'guideline:who-healthy-diet',
  kind: 'guideline',
  publishedAt: '2020-04-29',
};

function signal(ctx: RecommendationContext, type: string): NormalizedSignal | undefined {
  return ctx.signals.find((s) => s.type === type);
}

function sleepCandidates(ctx: RecommendationContext): Candidate[] {
  const sleep = signal(ctx, 'sleepDuration');
  if (!sleep) return [];
  if (sleep.confidence < 0.35) {
    return [
      {
        category: 'sleep',
        title: 'Not enough sleep history yet',
        action: 'Wear your device overnight a few more times so AIDr. can learn your usual range.',
        rationale: 'AIDr. needs about ten nights before it can compare tonight with your own pattern.',
        evidenceRefs: [{ ref: sleep.ref, kind: 'signal' }],
        confidence: 'low',
        effort: 'trivial',
        expectedBenefit: 0.3,
        traits: {},
      },
    ];
  }
  if (sleep.deviation != null && sleep.deviation < -30) {
    return [
      {
        category: 'sleep',
        title: 'Sleep is short against your usual',
        action: 'You may consider starting your wind-down 20 minutes earlier tonight.',
        rationale: `Your last week is ${describeDeviation(sleep)} — about ${Math.abs(Math.round(sleep.deviation))} minutes shorter than your own typical night.`,
        evidenceRefs: [{ ref: sleep.ref, kind: 'signal' }],
        confidence: sleep.confidence > 0.7 ? 'high' : 'medium',
        effort: 'light',
        expectedBenefit: 0.85,
        traits: { involvesSleepTiming: true },
      },
    ];
  }
  return [];
}

function activityCandidates(ctx: RecommendationContext): Candidate[] {
  const steps = signal(ctx, 'steps');
  if (!steps || steps.baseline == null) return [];
  if (steps.deviation != null && steps.deviation < -1500) {
    return [
      {
        category: 'activity',
        title: 'Movement is below your usual week',
        action: 'You may consider one ten-minute walk after a meal today.',
        rationale: `Your daily median is ${describeDeviation(steps)} for the last seven days.`,
        evidenceRefs: [{ ref: steps.ref, kind: 'signal' }],
        confidence: steps.confidence > 0.6 ? 'medium' : 'low',
        effort: 'light',
        expectedBenefit: 0.8,
        traits: { involvesIntenseActivity: false },
      },
    ];
  }
  return [];
}

function recoveryCandidates(ctx: RecommendationContext): Candidate[] {
  const rhr = signal(ctx, 'restingHeartRate');
  if (!rhr || rhr.deviation == null || rhr.baseline == null) return [];
  if (rhr.deviation > 3) {
    return [
      {
        category: 'recovery',
        title: 'Resting heart rate is above your usual band',
        action: 'You may consider keeping today easier, and noting how you feel in your journal.',
        rationale: `Resting heart rate is ${describeDeviation(rhr)} — roughly ${Math.round(rhr.deviation)} bpm above your own centre. Many everyday things move this number, including short sleep, alcohol and getting unwell.`,
        evidenceRefs: [{ ref: rhr.ref, kind: 'signal' }],
        confidence: rhr.confidence > 0.7 ? 'medium' : 'low',
        effort: 'trivial',
        expectedBenefit: 0.75,
        traits: { involvesIntenseActivity: false },
      },
    ];
  }
  return [];
}

function hydrationCandidates(ctx: RecommendationContext): Candidate[] {
  if (!ctx.nutrition) return [];
  return [
    {
      category: 'hydration',
      title: 'Keep water within reach',
      action: 'You may consider filling a bottle now so it is in sight this afternoon.',
      rationale: 'Making a habit visible is one of the more reliable ways to keep it going.',
      evidenceRefs: [WHO_DIET],
      confidence: 'medium',
      effort: 'trivial',
      expectedBenefit: 0.45,
      traits: { involvesHydration: true },
    },
  ];
}

function adherenceCandidates(ctx: RecommendationContext): Candidate[] {
  const struggling = ctx.plans.filter((p) => (ctx.adherence[p.id] ?? 1) < 0.7);
  if (struggling.length === 0) return [];
  const plan = struggling[0];
  return [
    {
      category: 'medicationAdherence',
      title: 'Some doses have not been logged',
      action:
        'You may consider pairing this reminder with something you already do daily, or moving the reminder time in Medications.',
      // Deliberately non-judgemental, and careful not to assert a missed dose:
      // an unlogged dose is not the same as an untaken one (§30).
      rationale:
        'Several reminders for one of your medicines went unlogged this week. That might just mean the logging step was inconvenient.',
      evidenceRefs: [{ ref: `plan:${plan.id}:adherence`, kind: 'userInput' }],
      confidence: 'medium',
      effort: 'light',
      expectedBenefit: 0.9,
      traits: {},
    },
  ];
}

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
