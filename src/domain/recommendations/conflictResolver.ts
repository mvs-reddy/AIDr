/**
 * Conflict resolver (spec §29 `ConflictResolver`, §28 P0/P1).
 *
 * This runs before any recommendation is shown. It answers one question:
 * *does this suggestion contradict something the user has verified?*
 *
 * The rules are intentionally conservative. A false "blocked" costs the user a
 * generic wellness tip. A false "allowed" could mean telling someone to fast
 * when their prescription says take with food.
 */

import type {
  MedicationPlan, Medication, NutritionProfile, SafetyFlag,
} from '../models';
import type { Candidate } from './engine';

export interface ConflictContext {
  plans: Array<MedicationPlan & { medication: Medication }>;
  nutrition: NutritionProfile | null;
  now: Date;
}

/** Phrases in a verified label that make a food-timing conflict possible. */
const WITH_FOOD = /\b(with|after)\s+(food|a\s+meal|meals|breakfast|dinner)\b/i;
const EMPTY_STOMACH = /\b(empty stomach|before\s+(food|a\s+meal|meals|breakfast)|\b1 hour before)\b/i;
const FLUID_RESTRICTION = /\b(fluid|water|drink)\s+(restrict|limit)/i;

export function resolveConflicts(candidate: Candidate, ctx: ConflictContext): SafetyFlag[] {
  const flags = new Set<SafetyFlag>();

  // ── P0: allergies. Hard block, never downranked. ───────────────────────────
  const allergies = ctx.nutrition?.allergies ?? [];
  const foods = candidate.traits.involvesFood ?? [];
  if (allergies.length && foods.length) {
    const hit = foods.some((f) =>
      allergies.some((a) => normalise(f).includes(normalise(a)) || normalise(a).includes(normalise(f))),
    );
    if (hit) flags.add('allergyConflict');
  }

  // ── P0: verified medication food instructions ──────────────────────────────
  // Only *verified* plans count. An unverified import must never gate advice,
  // because its text has not been confirmed by a human yet.
  const verified = ctx.plans.filter((p) => p.verifiedAt && p.foodInstructions);

  if (candidate.traits.involvesFasting) {
    if (verified.some((p) => WITH_FOOD.test(p.foodInstructions ?? ''))) {
      flags.add('medicationFoodConflict');
    }
  }
  if (candidate.traits.shiftsMealTime) {
    if (verified.some((p) => WITH_FOOD.test(p.foodInstructions ?? '') || EMPTY_STOMACH.test(p.foodInstructions ?? ''))) {
      flags.add('medicationFoodConflict');
    }
  }

  // ── P1: clinician-entered restrictions ─────────────────────────────────────
  const restrictions = ctx.nutrition?.clinicianRestrictions ?? [];
  if (candidate.traits.involvesHydration && restrictions.some((r) => FLUID_RESTRICTION.test(r.text))) {
    flags.add('clinicianRestriction');
  }
  if (candidate.traits.involvesIntenseActivity) {
    if (restrictions.some((r) => /\b(avoid|no|limit)\s+(exercise|exertion|strenuous)/i.test(r.text))) {
      flags.add('clinicianRestriction');
    }
  }
  // Any restriction that names a food this candidate promotes.
  if (foods.length && restrictions.length) {
    const hit = foods.some((f) => restrictions.some((r) => normalise(r.text).includes(normalise(f))));
    if (hit) flags.add('clinicianRestriction');
  }

  return [...flags];
}

// ─── Schedule-level conflicts, surfaced in the Medications screen ────────────

export type ScheduleConflict =
  | { kind: 'overlap'; planA: string; planB: string; at: string }
  | { kind: 'foodInstructionClash'; planA: string; planB: string; at: string }
  | { kind: 'duplicateMedication'; planA: string; planB: string; name: string }
  | { kind: 'timeZoneShift'; from: string; to: string };

/**
 * §26.1 — highlight for user or pharmacist review. AIDr. never reschedules on
 * its own, so this returns findings, not fixes.
 */
export function findScheduleConflicts(
  plans: Array<MedicationPlan & { medication: Medication }>,
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  // Duplicate medicines arriving from two sources (manual + platform import).
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i];
      const b = plans[j];
      const nameA = normalise(a.medication.normalizedName ?? a.medication.nameOriginal);
      const nameB = normalise(b.medication.normalizedName ?? b.medication.nameOriginal);
      if (nameA && nameA === nameB) {
        conflicts.push({
          kind: 'duplicateMedication',
          planA: a.id,
          planB: b.id,
          name: a.medication.nameOriginal,
        });
        continue;
      }

      const timesA = fixedTimes(a);
      const timesB = fixedTimes(b);
      const shared = timesA.filter((t) => timesB.includes(t));
      for (const at of shared) {
        const withFoodA = WITH_FOOD.test(a.foodInstructions ?? '');
        const emptyB = EMPTY_STOMACH.test(b.foodInstructions ?? '');
        const withFoodB = WITH_FOOD.test(b.foodInstructions ?? '');
        const emptyA = EMPTY_STOMACH.test(a.foodInstructions ?? '');

        if ((withFoodA && emptyB) || (withFoodB && emptyA)) {
          conflicts.push({ kind: 'foodInstructionClash', planA: a.id, planB: b.id, at });
        } else {
          conflicts.push({ kind: 'overlap', planA: a.id, planB: b.id, at });
        }
      }
    }
  }
  return conflicts;
}

function fixedTimes(plan: MedicationPlan): string[] {
  return plan.scheduleRule.kind === 'fixedTimes' ? plan.scheduleRule.times : [];
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Copy shown when a conflict blocks a suggestion. Names the *reason*, so the
 * user can see AIDr. is respecting something they entered rather than being
 * arbitrarily quiet.
 */
export const CONFLICT_COPY: Record<SafetyFlag, string> = {
  allergyConflict: 'Hidden because it involves a food you listed as an allergy.',
  clinicianRestriction: 'Hidden because it conflicts with a restriction you recorded from your clinician.',
  medicationFoodConflict: 'Hidden because one of your verified medicines has a food or timing instruction that this would work against.',
  lowDataCoverage: 'Shown with low confidence — there is not much data behind it yet.',
  emergencyLanguage: 'Paused. Please see the safety message above.',
  eatingDisorderRisk: 'Hidden. AIDr. does not show calorie or restriction targets in this context.',
  pregnancyContext: 'Shown as general information only. Please confirm anything specific with your clinician.',
};
