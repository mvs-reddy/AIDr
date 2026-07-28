/**
 * AIDr. domain model. Pure types + invariants — no I/O, no React, no platform APIs.
 * Mirrors spec §7 (core entities) and §29 (medication / nutrition / recommendation).
 */

export type UUID = string;
export type ISODate = string;

// ─── Health signals ──────────────────────────────────────────────────────────

export type SignalType =
  | 'steps' | 'distance' | 'activeEnergy' | 'exerciseMinutes' | 'floors'
  | 'restingHeartRate' | 'heartRate' | 'walkingHeartRate' | 'hrv' | 'vo2max'
  | 'respiratoryRate' | 'oxygenSaturation' | 'skinTemperature'
  | 'sleepDuration' | 'sleepSchedule'
  | 'walkingSpeed' | 'stepLength'
  | 'glucose' | 'bloodPressureSystolic' | 'bloodPressureDiastolic' | 'bodyTemperature'
  | 'weight' | 'bodyFat' | 'leanMass' | 'bmr'
  | 'hydration' | 'nutritionEnergy'
  | 'cycleDay';

export type SignalGroup =
  | 'activity' | 'cardiovascular' | 'sleep' | 'mobility' | 'metabolic' | 'body' | 'cycle';

/** A raw platform sample. NEVER leaves the device (spec §9.1). */
export interface HealthMetricSample {
  id: UUID;
  type: SignalType;
  value: number;
  unit: string;
  start: ISODate;
  end: ISODate;
  /** Local-only origin handle; the human-readable device name is never uploaded. */
  sourceLocalId: string;
  sourceKind: 'watch' | 'phone' | 'thirdParty' | 'manual' | 'clinical';
  timeZone: string;
}

/** The ONLY health shape permitted in a cloud payload. */
export interface NormalizedSignal {
  type: SignalType;
  /** e.g. `7d`, `28d`, `today`. */
  period: string;
  aggregate: number;
  unit: string;
  /** Personal centre for the reference window — never a population norm. */
  baseline: number | null;
  /** aggregate − baseline, in `unit`. */
  deviation: number | null;
  /** 0–1. coverage × sourceQuality × recency. */
  confidence: number;
  /** Stable handle an AI observation must cite, e.g. `signal:restingHeartRate:7d`. */
  ref: string;
}

export interface PersonalBaseline {
  type: SignalType;
  centre: number;
  spread: number;
  /** Robust band: centre ± k·MAD. */
  lower: number;
  upper: number;
  observations: number;
  coverage: number;
  confidence: number;
  windowDays: number;
  computedAt: ISODate;
}

// ─── Workflows and runs ──────────────────────────────────────────────────────

export type WorkflowKind =
  | 'visitPrep' | 'explainResults' | 'medicationReview' | 'documentSummary' | 'journalReflection';

/** Spec §10.1 — the run state machine. Transitions are enforced in `runner.ts`. */
export type RunStatus =
  | 'idle' | 'collectingInput' | 'importing' | 'extractingText' | 'redacting'
  | 'awaitingConsent' | 'buildingContext' | 'requestingAI' | 'validatingOutput'
  | 'presentingResult' | 'saved' | 'shared' | 'failed' | 'cancelled';

export type FocusTag = 'sleep' | 'energy' | 'pain' | 'medication' | 'mood' | 'digestion';

export interface WorkflowInputs {
  fields: Record<string, string>;
  focus: FocusTag[];
  documentIds: UUID[];
  includeHealthContext: boolean;
}

export interface WorkflowRun {
  id: UUID;
  type: WorkflowKind;
  status: RunStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
  inputs: WorkflowInputs;
  /** SHA-256 of the exact bytes sent. Proves what left, without storing it twice. */
  redactedPayloadHash: string | null;
  consentReceiptId: UUID | null;
  output: AIWorkflowOutput | null;
  modelLabel: string | null;
  failureReason: string | null;
  disclaimer: string;
}

// ─── AI output contract (spec §10.4) ─────────────────────────────────────────

export type Confidence = 'low' | 'medium' | 'high';

export interface Observation {
  statement: string;
  /** At least one ref required for any statement rendered as fact (§18.1). */
  evidenceRefs: string[];
  confidence: Confidence;
}

export interface AIWorkflowOutput {
  headline: string;
  summary: string[];
  observations: Observation[];
  questionsForClinician: string[];
  uncertainties: string[];
  urgentSafetyMessage: string | null;
  disclaimer: string;
  schemaVersion: string;
}

// ─── Journal, documents, labs ────────────────────────────────────────────────

export interface JournalEntry {
  id: UUID;
  /** Never included in any payload, log, backup or analytics event. */
  rawTextLocal: string;
  redactedText: string;
  reflection: string | null;
  linkedSignalRefs: string[];
  wordCount: number;
  createdAt: ISODate;
}

export type DailyReadKind = 'morning' | 'midday' | 'evening' | 'weekly';

export interface DailyRead {
  id: UUID;
  kind: DailyReadKind;
  date: ISODate;
  headline: string;
  body: string;
  suggestion: string | null;
  evidenceRefs: string[];
  aiGenerated: boolean;
}

export interface ImportedDocument {
  id: UUID;
  localURI: string;
  mimeType: string;
  /** OCR output. Local only. */
  ocrTextLocal: string;
  redactedText: string;
  pageCount: number;
  checksum: string;
  classifiedAs: 'labReport' | 'clinicNote' | 'prescription' | 'discharge' | 'unknown';
  importedAt: ISODate;
  excludedFromBackup: boolean;
}

export interface LabResult {
  id: UUID;
  /** The laboratory's own analyte name, preserved verbatim (§12.1). */
  nameOriginal: string;
  normalizedCode: string | null;
  value: string;
  numericValue: number | null;
  unit: string | null;
  /** The printed range, verbatim. The only place "normal/abnormal" language is allowed. */
  printedRange: string | null;
  flag: 'low' | 'high' | 'abnormal' | 'normal' | null;
  reportDate: ISODate | null;
  sourceDocumentId: UUID;
  correctedByUser: boolean;
}

// ─── Medication (spec §26–§27) ───────────────────────────────────────────────

export type MedicationSource =
  | 'manualEntry' | 'labelScan' | 'healthKit' | 'healthConnect' | 'clinicianImport' | 'caregiver';

export interface Medication {
  id: UUID;
  nameOriginal: string;
  normalizedName: string | null;
  form: string | null;
  strength: string | null;
  isOTC: boolean;
  /** `active` gates reminders; `paused`/`completed` retain history. */
  state: 'active' | 'paused' | 'completed';
  source: MedicationSource;
  createdAt: ISODate;
}

export type ScheduleRule =
  | { kind: 'fixedTimes'; times: string[]; daysOfWeek?: number[] }
  | { kind: 'interval'; everyHours: number; anchor: string }
  | { kind: 'cycle'; onDays: number; offDays: number; anchorDate: ISODate }
  | { kind: 'asNeeded'; maxPerDay?: number }
  | { kind: 'taper'; steps: Array<{ from: ISODate; doseText: string; times: string[] }> };

export interface MedicationPlan {
  id: UUID;
  medicationId: UUID;
  /** Verbatim from the label or clinician. AIDr. never authors this string. */
  doseText: string;
  scheduleRule: ScheduleRule;
  foodInstructions: string | null;
  startDate: ISODate;
  endDate: ISODate | null;
  /** Null until the user completes the verification screen. Reminders stay off. */
  verifiedAt: ISODate | null;
  verifiedBy: 'user' | 'caregiver' | 'clinician' | null;
  sourceQuote: string | null;
  isCritical: boolean;
}

export type DoseStatus =
  | 'taken' | 'skipped' | 'snoozed' | 'partial' | 'unavailable' | 'notLogged';

export interface DoseEvent {
  id: UUID;
  planId: UUID;
  scheduledAt: ISODate;
  /** When the user actually acted. Kept distinct from `scheduledAt`. */
  actionAt: ISODate | null;
  status: DoseStatus;
  quantity: string | null;
  note: string | null;
  timeZone: string;
  writtenToPlatform: boolean;
}

export interface ReminderPolicy {
  leadTimeMinutes: number;
  gracePeriodMinutes: number;
  followUpCount: number;
  /** When true, notifications say "A medication is due" with no name. Default true. */
  lockScreenPrivacy: boolean;
  caregiverEscalation: boolean;
}

export interface MedicationInventory {
  planId: UUID;
  quantity: number;
  unit: string;
  refillThreshold: number;
  lastConfirmedAt: ISODate;
}

// ─── Nutrition (spec §25.2) ──────────────────────────────────────────────────

export interface NutritionProfile {
  dietaryPattern: string | null;
  allergies: string[];
  intolerances: string[];
  /** Only a qualified professional's restriction unlocks Tier C guidance. */
  clinicianRestrictions: Array<{ text: string; enteredBy: string; date: ISODate }>;
  culturalCuisines: string[];
  budgetBand: 'low' | 'medium' | 'high' | null;
  cookingFacilities: string[];
  goals: string[];
}

export interface MealEntry {
  id: UUID;
  capturedAt: ISODate;
  source: 'photo' | 'text' | 'voice' | 'barcode' | 'template';
  foods: Array<{ name: string; portion: string | null; confidence: number }>;
  /** Vision output stays provisional until this flips (§30). */
  userConfirmed: boolean;
  notes: string | null;
  linkedSymptoms: string[];
}

// ─── Recommendations (spec §24.1, §28) ───────────────────────────────────────

export type WellnessCategory =
  | 'sleep' | 'activity' | 'recovery' | 'stress' | 'nutrition' | 'hydration'
  | 'medicationAdherence' | 'preventive' | 'habit';

export type SafetyFlag =
  | 'allergyConflict' | 'clinicianRestriction' | 'medicationFoodConflict'
  | 'lowDataCoverage' | 'emergencyLanguage' | 'eatingDisorderRisk' | 'pregnancyContext';

export type SafetyTier = 'generalWellness' | 'discussWithClinician' | 'urgentSafety';

export interface EvidenceRef {
  /** `signal:…`, `doc:…:p3`, `guideline:who-healthy-diet-2020`, `label:…`. */
  ref: string;
  kind: 'signal' | 'document' | 'guideline' | 'label' | 'userInput';
  publishedAt?: ISODate;
  jurisdiction?: string;
}

export interface WellnessRecommendation {
  id: UUID;
  category: WellnessCategory;
  title: string;
  action: string;
  rationale: string;
  evidenceRefs: EvidenceRef[];
  confidence: Confidence;
  effort: 'trivial' | 'light' | 'moderate';
  validUntil: ISODate;
  contraindicationFlags: SafetyFlag[];
  safetyTier: SafetyTier;
  sourcePolicyVersion: string;
  aiGenerated: boolean;
  feedback: 'none' | 'completed' | 'snoozed' | 'dismissed' | 'notRelevant';
}

// ─── Consent, privacy, sharing ───────────────────────────────────────────────

export interface ConsentReceipt {
  id: UUID;
  grantedAt: ISODate;
  policyVersion: string;
  provider: string;
  model: string;
  workflow: WorkflowKind;
  /** Signal types and document ids the user agreed to include, by category. */
  scope: string[];
  purpose: string;
}

export interface PrivacyLogEntry {
  id: UUID;
  at: ISODate;
  workflow: WorkflowKind | 'dailyRead';
  categories: string[];
  destination: 'onDevice' | 'cloudProvider';
  redactionEngine: string;
  spansRedacted: number;
  payloadHash: string | null;
}

export interface SharedExport {
  id: UUID;
  createdAt: ISODate;
  expiresAt: ISODate;
  revokedAt: ISODate | null;
  secureLinkTokenHash: string;
  runId: UUID | null;
  label: string;
}
