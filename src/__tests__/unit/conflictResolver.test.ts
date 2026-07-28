/**
 * The conflict cases the spec calls out by name (§28): a fasting suggestion must
 * be suppressed when it contradicts a verified food-with-medication instruction,
 * and hydration prompts must respect clinician fluid restrictions.
 */

import {
  resolveConflicts,
  findScheduleConflicts,
} from '../../domain/recommendations/conflictResolver';
import type { Candidate } from '../../domain/recommendations/engine';
import type { Medication, MedicationPlan, NutritionProfile } from '../../domain/models';

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  category: 'nutrition',
  title: 'Try a later breakfast',
  action: 'You may consider pushing breakfast an hour later.',
  rationale: '',
  evidenceRefs: [],
  confidence: 'medium',
  effort: 'light',
  expectedBenefit: 0.6,
  traits: {},
  ...over,
});

const medication = (name: string): Medication => ({
  id: `m-${name}`,
  nameOriginal: name,
  normalizedName: name.toLowerCase(),
  form: 'tablet',
  strength: '500 mg',
  isOTC: false,
  state: 'active',
  source: 'manualEntry',
  createdAt: '',
});

const plan = (
  over: Partial<MedicationPlan> & { medication: Medication },
): MedicationPlan & { medication: Medication } => ({
  id: 'p1',
  medicationId: over.medication.id,
  doseText: 'One tablet',
  scheduleRule: { kind: 'fixedTimes', times: ['08:00'] },
  foodInstructions: null,
  startDate: '2026-01-01',
  endDate: null,
  verifiedAt: '2026-01-01',
  verifiedBy: 'user',
  sourceQuote: null,
  isCritical: false,
  ...over,
});

const profile = (over: Partial<NutritionProfile> = {}): NutritionProfile => ({
  dietaryPattern: null,
  allergies: [],
  intolerances: [],
  clinicianRestrictions: [],
  culturalCuisines: [],
  budgetBand: null,
  cookingFacilities: [],
  goals: [],
  ...over,
});

describe('medication food instructions block conflicting advice', () => {
  const withFood = plan({
    medication: medication('Metformin'),
    foodInstructions: 'Take with food in the morning',
  });

  it('blocks a fasting suggestion', () => {
    const flags = resolveConflicts(candidate({ traits: { involvesFasting: true } }), {
      plans: [withFood],
      nutrition: profile(),
      now: new Date(),
    });
    expect(flags).toContain('medicationFoodConflict');
  });

  it('blocks a meal-time shift', () => {
    const flags = resolveConflicts(candidate({ traits: { shiftsMealTime: true } }), {
      plans: [withFood],
      nutrition: profile(),
      now: new Date(),
    });
    expect(flags).toContain('medicationFoodConflict');
  });

  it('does NOT block when the plan is unverified', () => {
    const unverified = plan({
      medication: medication('Metformin'),
      foodInstructions: 'Take with food',
      verifiedAt: null,
      verifiedBy: null,
    });
    const flags = resolveConflicts(candidate({ traits: { involvesFasting: true } }), {
      plans: [unverified],
      nutrition: profile(),
      now: new Date(),
    });
    expect(flags).not.toContain('medicationFoodConflict');
  });

  it('leaves unrelated advice alone', () => {
    const flags = resolveConflicts(candidate({ traits: { involvesSleepTiming: true } }), {
      plans: [withFood],
      nutrition: profile(),
      now: new Date(),
    });
    expect(flags).toHaveLength(0);
  });
});

describe('allergies and clinician restrictions', () => {
  it('blocks a food the user is allergic to', () => {
    const flags = resolveConflicts(candidate({ traits: { involvesFood: ['peanut butter'] } }), {
      plans: [],
      nutrition: profile({ allergies: ['Peanut'] }),
      now: new Date(),
    });
    expect(flags).toContain('allergyConflict');
  });

  it('blocks hydration prompts under a fluid restriction', () => {
    const flags = resolveConflicts(candidate({ traits: { involvesHydration: true } }), {
      plans: [],
      nutrition: profile({
        clinicianRestrictions: [
          { text: 'Fluid restrict to 1.2 L daily', enteredBy: 'Renal team', date: '2026-05-01' },
        ],
      }),
      now: new Date(),
    });
    expect(flags).toContain('clinicianRestriction');
  });

  it('blocks intense activity when exertion is restricted', () => {
    const flags = resolveConflicts(candidate({ traits: { involvesIntenseActivity: true } }), {
      plans: [],
      nutrition: profile({
        clinicianRestrictions: [
          { text: 'Avoid strenuous exercise for six weeks', enteredBy: 'Surgeon', date: '2026-06-01' },
        ],
      }),
      now: new Date(),
    });
    expect(flags).toContain('clinicianRestriction');
  });
});

describe('schedule conflicts are surfaced, never auto-fixed', () => {
  it('detects a duplicate medicine from two sources', () => {
    const a = plan({ id: 'a', medication: medication('Ramipril') });
    const b = plan({
      id: 'b',
      medication: { ...medication('Ramipril'), id: 'm2', source: 'healthConnect' },
    });
    const conflicts = findScheduleConflicts([a, b]);
    expect(conflicts.some((c) => c.kind === 'duplicateMedication')).toBe(true);
  });

  it('detects a with-food versus empty-stomach clash at the same time', () => {
    const a = plan({
      id: 'a',
      medication: medication('Levothyroxine'),
      foodInstructions: 'Take on an empty stomach',
    });
    const b = plan({
      id: 'b',
      medication: medication('Ibuprofen'),
      foodInstructions: 'Take with food',
    });
    const conflicts = findScheduleConflicts([a, b]);
    expect(conflicts.some((c) => c.kind === 'foodInstructionClash')).toBe(true);
  });
});
