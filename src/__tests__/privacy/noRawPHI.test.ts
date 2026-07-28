/**
 * Privacy suite (spec §18 "Privacy", §18.1).
 *
 * The acceptance criterion is blunt: "Network inspection shows no raw HealthKit
 * sample, original document or unredacted note." These tests assert the property
 * at the point where it can actually be violated — the payload builder.
 */

import { RedactionService } from '../../services/redaction/RedactionService';
import { buildUserPrompt, buildSystemPrompt } from '../../services/ai/prompts';
import type { RedactedAIRequest } from '../../services/ai/AIProvider';
import type { NormalizedSignal } from '../../domain/models';

const NOTE = `Sarah Mills, DOB 14/03/1981, NHS 485 777 3456, 42 Elmfield Road, SW19 4LP.
Seen by Dr Helen Chaudhry at St Mary's Hospital. Email sarah.mills@example.com, 07700 900123.
Tired in the afternoons for two weeks. Resting heart rate trending up.`;

const IDENTIFIERS = [
  'Sarah Mills',
  '14/03/1981',
  '485 777 3456',
  'Elmfield Road',
  'SW19 4LP',
  'Helen Chaudhry',
  'sarah.mills@example.com',
];

/**
 * These run at the *pattern-only* tier — no native module is present under Jest,
 * so `getNERBackend()` returns null. That is deliberate: the floor is what ships
 * to a user who declines the 40 MB clinical pack, and the floor is what has to
 * hold. Anything the pack adds on top is a bonus, not a dependency.
 */
describe('redaction removes identifiers before any payload exists', () => {
  const service = new RedactionService();

  it('strips every identifier class from the sample note', async () => {
    const result = await service.redact(NOTE);
    for (const identifier of IDENTIFIERS) {
      expect(result.redactedText).not.toContain(identifier);
    }
  });

  it('reports the pattern-only engine honestly, never claiming stronger cover', async () => {
    const result = await service.redact(NOTE);
    expect(result.engine).toBe('patterns');
  });

  /**
   * Name detection is tiered by how much surrounding evidence exists. A labelled
   * or cue-adjacent name is removed silently; a bare line-initial name goes to
   * review, because the same shape also matches a lab row like
   * "Blood Pressure, 120/80" and silently mangling a result is its own harm.
   */
  it('auto-removes a labelled name', async () => {
    const result = await service.redact('Patient: Sarah Mills\nFeeling tired.');
    const span = result.spans.find((s) => s.entity === 'person');
    expect(span?.disposition).toBe('auto');
  });

  /**
   * The label has to survive. If the whole match were replaced, a clinician
   * reading the export would see a bare placeholder with no idea it stood for a
   * patient name rather than a date or a facility.
   */
  it('replaces only the name, keeping the surrounding label intact', async () => {
    const result = await service.redact('Patient: Sarah Mills\nFeeling tired.');
    expect(result.redactedText).toMatch(/^Patient: \[NAME_1\]/);
    expect(result.redactedText).toContain('Feeling tired.');
  });

  it('auto-removes a name sitting next to an identifier cue', async () => {
    const result = await service.redact('Sarah Mills, DOB 14/03/1981');
    expect(result.redactedText).not.toContain('Sarah Mills');
  });

  it('sends a bare line-initial name to review rather than removing it silently', async () => {
    const result = await service.redact('Helen Brookes, seen in clinic today.');
    const span = result.spans.find((s) => s.entity === 'person');
    expect(span?.disposition).toBe('review');
    expect(result.requiresReview).toBe(true);
  });

  it('keeps the clinically useful content', async () => {
    const result = await service.redact(NOTE);
    expect(result.redactedText).toContain('Tired in the afternoons for two weeks');
    expect(result.redactedText).toContain('Resting heart rate trending up');
  });

  it('produces a stable payload hash', async () => {
    const a = await service.redact(NOTE);
    const b = await service.redact(NOTE);
    expect(a.payloadHash).toBe(b.payloadHash);
    expect(a.payloadHash).toHaveLength(64);
  });

  it('clears the reversible map on dispose', async () => {
    await service.redact(NOTE);
    service.dispose();
    expect(service.restoreForDisplay('[NAME_1]')).toBe('[NAME_1]');
  });
});

describe('prompt payloads carry no raw records', () => {
  const signals: NormalizedSignal[] = [
    {
      type: 'restingHeartRate',
      period: '7d',
      aggregate: 64,
      unit: 'count/min',
      baseline: 60,
      deviation: 4,
      confidence: 0.82,
      ref: 'signal:restingHeartRate:7d',
    },
  ];

  const request = (redactedText: string): RedactedAIRequest => ({
    runId: 'test',
    workflow: 'visitPrep',
    redactedText,
    normalizedSignals: signals,
    locale: 'en',
    model: 'test-model',
    safetyPolicyVersion: 'test',
    consentReceipt: {
      id: 'c1',
      grantedAt: '',
      policyVersion: '',
      provider: 'test',
      model: 'test-model',
      workflow: 'visitPrep',
      scope: [],
      purpose: '',
    },
  });

  it('contains no identifier from the original note', async () => {
    const service = new RedactionService();
    const { redactedText } = await service.redact(NOTE);
    const payload = buildUserPrompt(request(redactedText));
    for (const identifier of IDENTIFIERS) {
      expect(payload).not.toContain(identifier);
    }
  });

  it('carries aggregates and baselines, never individual samples', () => {
    const payload = buildUserPrompt(request('redacted'));
    expect(payload).toContain('signal:restingHeartRate:7d');
    expect(payload).toContain('personal baseline 60');
    // A sample-level timestamp would indicate a raw record leaked through.
    expect(payload).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('tells the model to leave placeholders alone', () => {
    const system = buildSystemPrompt(request('[NAME_1] reported fatigue'));
    expect(system).toMatch(/never guess what they stood for/i);
  });

  it('instructs the model not to invent a trend when no signals were shared', () => {
    const payload = buildUserPrompt({ ...request('some text'), normalizedSignals: [] });
    expect(payload).toMatch(/do not speculate about trends/i);
  });
});
