/**
 * The workflow runner — spec §10.1's state machine, made executable.
 *
 *   idle → collectingInput → importing → extractingText → redacting →
 *   awaitingConsent → buildingContext → requestingAI → validatingOutput →
 *   presentingResult → saved | shared | failed | cancelled
 *
 * Three gates are non-bypassable, and every one of them lives here so there is
 * exactly one code path to audit:
 *
 *   Gate A  emergency screen on the raw local text — stops before anything leaves
 *   Gate B  redaction + consent receipt — no receipt, no request
 *   Gate C  schema + evidence + clinical validation — no render without it
 */

import * as Crypto from 'expo-crypto';
import type {
  AIWorkflowOutput, ConsentReceipt, NormalizedSignal, WorkflowInputs, WorkflowKind, WorkflowRun, RunStatus,
} from '../../domain/models';
import {
  DISCLAIMER, SAFETY_POLICY_VERSION, detectEmergency, validateOutput, correctionNote,
  EMERGENCY_COPY, type EmergencyKind,
} from '../../domain/safety/policy';
import { parseWorkflowOutput, evidenceRefsResolve } from '../../domain/safety/outputSchema';
import { redactionService, type RedactionResult } from '../redaction/RedactionService';
import type { AIProvider, RedactedAIRequest } from './AIProvider';
import { safeMessageFor } from './AIProvider';
import { privacyLog } from '../audit/privacyLog';

export interface RunContext {
  workflow: WorkflowKind;
  inputs: WorkflowInputs;
  signals: NormalizedSignal[];
  locale: string;
  model: string;
  provider: AIProvider;
  /** Resolves when the user accepts the consent sheet; rejects on cancel. */
  requestConsent: (summary: ConsentSummary) => Promise<boolean>;
  /** Shown when redaction flags an ambiguous span. Resolves with edited text. */
  requestRedactionReview: (result: RedactionResult) => Promise<string | null>;
  onStatus?: (status: RunStatus) => void;
  onDelta?: (text: string) => void;
  onEmergency?: (kind: EmergencyKind, copy: { title: string; body: string }) => void;
}

export interface ConsentSummary {
  workflow: WorkflowKind;
  model: string;
  signalTypes: string[];
  charactersOfText: number;
  spansRedacted: number;
  engine: string;
}

export type RunResult =
  | { ok: true; run: WorkflowRun }
  | { ok: false; status: RunStatus; message: string };

const MAX_VALIDATION_RETRIES = 1;

export async function executeRun(ctx: RunContext): Promise<RunResult> {
  const runId = Crypto.randomUUID();
  const now = () => new Date().toISOString();
  let status: RunStatus = 'collectingInput';

  const set = (s: RunStatus) => {
    status = s;
    ctx.onStatus?.(s);
  };

  const fail = (message: string): RunResult => {
    set('failed');
    return { ok: false, status: 'failed', message };
  };

  // ── Gate A: emergency screen, on the raw local text, before anything moves ──
  const localText = collectText(ctx.inputs);
  const emergency = detectEmergency(localText);
  if (emergency) {
    ctx.onEmergency?.(emergency, EMERGENCY_COPY[emergency]);
    set('cancelled');
    return {
      ok: false,
      status: 'cancelled',
      message: EMERGENCY_COPY[emergency].body,
    };
  }

  // ── Redaction ──────────────────────────────────────────────────────────────
  set('redacting');
  await redactionService.prepare();
  let redaction = await redactionService.redact(localText);

  if (redaction.requiresReview) {
    const edited = await ctx.requestRedactionReview(redaction);
    if (edited === null) {
      set('cancelled');
      return { ok: false, status: 'cancelled', message: 'Run cancelled before anything was sent.' };
    }
    redaction = await redactionService.redact(edited);
    if (redaction.requiresReview) {
      return fail(
        'AIDr. still found details that might identify you. Edit the text or remove the document, then try again.',
      );
    }
  }

  // ── Gate B: consent ────────────────────────────────────────────────────────
  set('awaitingConsent');
  const summary: ConsentSummary = {
    workflow: ctx.workflow,
    model: ctx.model,
    signalTypes: ctx.signals.map((s) => s.type),
    charactersOfText: redaction.redactedText.length,
    spansRedacted: redaction.spans.length,
    engine: redaction.engine,
  };
  const consented = await ctx.requestConsent(summary);
  if (!consented) {
    set('cancelled');
    return { ok: false, status: 'cancelled', message: 'Run cancelled. Nothing left this device.' };
  }

  const receipt: ConsentReceipt = {
    id: Crypto.randomUUID(),
    grantedAt: now(),
    policyVersion: SAFETY_POLICY_VERSION,
    provider: (await ctx.provider.capabilities()).providerId,
    model: ctx.model,
    workflow: ctx.workflow,
    scope: [...summary.signalTypes, ...(redaction.redactedText ? ['redactedText'] : [])],
    purpose: `Run ${ctx.workflow} and return a structured, non-diagnostic brief.`,
  };

  // ── Build the minimized payload ────────────────────────────────────────────
  set('buildingContext');
  const request: RedactedAIRequest = {
    runId,
    workflow: ctx.workflow,
    redactedText: redaction.redactedText,
    normalizedSignals: ctx.signals,
    locale: ctx.locale,
    model: ctx.model,
    safetyPolicyVersion: SAFETY_POLICY_VERSION,
    consentReceipt: receipt,
  };

  await privacyLog.record({
    workflow: ctx.workflow,
    categories: [...new Set(ctx.signals.map((s) => s.type))],
    destination: 'cloudProvider',
    redactionEngine: redaction.engine,
    spansRedacted: redaction.spans.length,
    payloadHash: redaction.payloadHash,
  });

  // ── Request + Gate C, with one corrective retry ────────────────────────────
  const availableRefs = new Set(ctx.signals.map((s) => s.ref).concat('userInput:notes'));
  let attempt = 0;
  let correction: string | undefined;

  while (attempt <= MAX_VALIDATION_RETRIES) {
    set('requestingAI');
    let raw = '';
    let modelUsed = ctx.model;
    let errored: string | null = null;

    for await (const event of ctx.provider.stream({ ...request, correction })) {
      if (event.type === 'delta') {
        raw += event.text;
        ctx.onDelta?.(event.text);
      } else if (event.type === 'done') {
        raw = event.text;
        modelUsed = event.modelUsed;
      } else {
        errored = event.safeMessage;
      }
    }
    if (errored) return fail(errored);

    set('validatingOutput');
    const parsed = parseWorkflowOutput(raw);
    if (!parsed.ok) {
      attempt += 1;
      correction = `Your previous response could not be parsed (${parsed.issue}). Return valid JSON matching the schema, and nothing else.`;
      if (attempt > MAX_VALIDATION_RETRIES) {
        return fail(safeMessageFor('unknown', ctx.model));
      }
      continue;
    }

    const clinical = validateOutput(parsed.value);
    const refs = evidenceRefsResolve(parsed.value, availableRefs);

    if (!clinical.ok || !refs.ok) {
      attempt += 1;
      correction = [
        clinical.ok ? null : correctionNote(clinical.violations),
        refs.ok
          ? null
          : `These evidenceRefs do not exist: ${refs.unknown.join(', ')}. Use only the supplied references or move the statement to "uncertainties".`,
      ]
        .filter(Boolean)
        .join('\n');

      if (attempt > MAX_VALIDATION_RETRIES) {
        return fail(
          clinical.message ??
            'AIDr. could not verify this response against your own data, so it was discarded.',
        );
      }
      continue;
    }

    // ── Success ──────────────────────────────────────────────────────────────
    set('presentingResult');
    redactionService.dispose();

    const run: WorkflowRun = {
      id: runId,
      type: ctx.workflow,
      status: 'presentingResult',
      createdAt: now(),
      updatedAt: now(),
      inputs: ctx.inputs,
      redactedPayloadHash: redaction.payloadHash,
      consentReceiptId: receipt.id,
      output: normaliseDisclaimer(parsed.value),
      modelLabel: modelUsed,
      failureReason: null,
      disclaimer: DISCLAIMER,
    };
    return { ok: true, run };
  }

  return fail('AIDr. could not produce a response that met its safety checks.');
}

function collectText(inputs: WorkflowInputs): string {
  const fields = Object.entries(inputs.fields)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `${humanise(k)}: ${v.trim()}`);
  if (inputs.focus.length) fields.push(`Focus areas: ${inputs.focus.join(', ')}`);
  return fields.join('\n\n');
}

function humanise(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/** The disclaimer is ours, not the model's — overwrite whatever came back. */
function normaliseDisclaimer(output: AIWorkflowOutput): AIWorkflowOutput {
  return { ...output, disclaimer: DISCLAIMER };
}
