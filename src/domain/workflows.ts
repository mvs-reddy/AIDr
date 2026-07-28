/**
 * Workflow definitions.
 *
 * §22 observed that the supplied screens share one form skeleton: health context
 * card → optional fields → focus chips → document import → privacy disclosure →
 * sticky CTA. Rather than four near-identical screens, the shape is data and one
 * renderer consumes it. Adding a fifth workflow is a new entry here.
 */

import type { FocusTag, WorkflowKind } from './models';
import type { FeatureScope } from '../services/health/HealthAdapter';

export interface FieldSpec {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
  /** One field per workflow may be required for the CTA to enable. */
  required?: boolean;
  hint?: string;
}

export interface WorkflowSpec {
  kind: WorkflowKind;
  /** Home card copy. */
  title: string;
  subtitle: string;
  /** Detail header: "Prepare for your *visit*." */
  headline: { lead: string; emphasis: string; trail?: string };
  description: string;
  ctaLabel: string;
  healthScope: FeatureScope;
  fields: FieldSpec[];
  showFocusChips: boolean;
  allowDocumentImport: boolean;
  /**
   * Whether the CTA can run on health context alone. Visit Prep can — the whole
   * point is turning numbers into questions. Explain Results cannot: with no
   * text and no document there is nothing to explain.
   */
  runnableFromHealthAlone: boolean;
}

export const FOCUS_TAGS: Array<{ tag: FocusTag; label: string }> = [
  { tag: 'sleep', label: 'Sleep' },
  { tag: 'energy', label: 'Energy' },
  { tag: 'pain', label: 'Pain' },
  { tag: 'medication', label: 'Medication' },
  { tag: 'mood', label: 'Mood' },
  { tag: 'digestion', label: 'Digestion' },
];

export const WORKFLOWS: WorkflowSpec[] = [
  {
    kind: 'visitPrep',
    title: 'Visit Prep',
    subtitle: 'Turn recent health signals into questions for your next appointment.',
    headline: { lead: 'Prepare for your ', emphasis: 'visit' },
    description: 'Turn recent health signals into questions for your next appointment.',
    ctaLabel: 'Run Visit Prep',
    healthScope: 'visitPrep',
    showFocusChips: true,
    allowDocumentImport: true,
    runnableFromHealthAlone: true,
    fields: [
      {
        key: 'reasonForVisit',
        label: 'Reason for visit',
        placeholder: 'e.g. blood-pressure follow-up',
      },
      {
        key: 'anythingElse',
        label: 'Anything else?',
        placeholder: 'Symptoms, medications, questions…',
        multiline: true,
      },
    ],
  },
  {
    kind: 'explainResults',
    title: 'Explain Results',
    subtitle: 'Translate labs or notes into plain-language patterns to review.',
    headline: { lead: 'Explain your ', emphasis: 'results' },
    description: 'Translate labs or notes into plain-language patterns to review.',
    ctaLabel: 'Run Explain Results',
    healthScope: 'visitPrep',
    showFocusChips: true,
    allowDocumentImport: true,
    runnableFromHealthAlone: false,
    fields: [
      {
        key: 'result',
        label: 'Result',
        placeholder: 'Paste the result, or scan a document below',
        multiline: true,
        required: true,
      },
      {
        key: 'whatToUnderstand',
        label: 'What do you want to understand?',
        placeholder: 'Optional',
      },
    ],
  },
  {
    kind: 'medicationReview',
    title: 'Medication Review',
    subtitle: 'Check medication mentions and unresolved follow-up points.',
    headline: { lead: 'Review your ', emphasis: 'medications' },
    description: 'Check medication mentions and unresolved follow-up points.',
    ctaLabel: 'Run Medication Review',
    healthScope: 'medication',
    showFocusChips: true,
    allowDocumentImport: true,
    runnableFromHealthAlone: false,
    fields: [
      {
        key: 'currentMedications',
        label: 'Current medications',
        placeholder: 'One per line if you can',
        multiline: true,
        required: true,
        hint: 'Include over-the-counter medicines, vitamins and supplements — a complete list makes clinical review safer.',
      },
      {
        key: 'concerns',
        label: 'Any concerns or questions?',
        placeholder: 'Optional',
        multiline: true,
      },
    ],
  },
  {
    kind: 'documentSummary',
    title: 'Scan & Redact',
    subtitle: 'Scan or paste a note, redact identifiers, and inspect entities.',
    headline: { lead: 'Scan and ', emphasis: 'redact' },
    description: 'Scan or paste a note, redact identifiers, and inspect entities.',
    ctaLabel: 'Run Document Summary',
    healthScope: 'visitPrep',
    showFocusChips: false,
    allowDocumentImport: true,
    runnableFromHealthAlone: false,
    fields: [
      {
        key: 'documentText',
        label: 'Document text',
        placeholder: 'Paste text, or scan a document below',
        multiline: true,
        required: true,
      },
    ],
  },
];

export function workflowByKind(kind: string): WorkflowSpec | undefined {
  return WORKFLOWS.find((w) => w.kind === kind);
}
