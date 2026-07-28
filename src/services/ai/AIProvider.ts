/**
 * Provider abstraction (spec §10.2).
 *
 * The model label shown in Settings is *configuration*, never a compile-time
 * constant. Critically, when the UI declares "No fallback", a provider that
 * cannot serve the requested model must fail loudly — silently downgrading to a
 * cheaper model would break the promise printed on the privacy card (§18.1).
 */

import type { NormalizedSignal, WorkflowKind, ConsentReceipt } from '../../domain/models';

export interface ProviderCapabilities {
  providerId: string;
  displayName: string;
  models: string[];
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  /** Where the request terminates. Shown verbatim in the privacy log. */
  processorRegion: string | null;
  /** True when the account's terms exclude the payload from model training. */
  excludedFromTraining: boolean;
}

/** The ONLY shape that may cross the network boundary. */
export interface RedactedAIRequest {
  runId: string;
  workflow: WorkflowKind;
  /** Already through `RedactionService`. Placeholders, never originals. */
  redactedText: string;
  normalizedSignals: NormalizedSignal[];
  locale: string;
  model: string;
  safetyPolicyVersion: string;
  consentReceipt: ConsentReceipt;
  /** Appended after a failed validation gate to force a corrected retry. */
  correction?: string;
}

export type AIEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; modelUsed: string }
  | { type: 'error'; code: AIErrorCode; safeMessage: string };

export type AIErrorCode =
  | 'notConfigured' | 'unauthorized' | 'modelUnavailable' | 'rateLimited'
  | 'network' | 'timeout' | 'cancelled' | 'contentFiltered' | 'unknown';

export interface AIProvider {
  capabilities(): Promise<ProviderCapabilities>;
  stream(request: RedactedAIRequest): AsyncGenerator<AIEvent, void, unknown>;
  cancel(runId: string): void;
}

/**
 * Maps raw provider failures to user-safe copy. Raw error bodies can echo the
 * prompt back, which would defeat redaction in a log — so they never surface.
 */
export function safeMessageFor(code: AIErrorCode, modelLabel: string): string {
  switch (code) {
    case 'notConfigured':
      return 'Connect an AI account in Settings to run cloud workflows. Everything on-device keeps working.';
    case 'unauthorized':
      return 'Your AI account could not be verified. Reconnect it in Settings.';
    case 'modelUnavailable':
      return `${modelLabel} is not available on your account right now. AIDr. will not switch models on your behalf — choose a different model in Settings if you want to continue.`;
    case 'rateLimited':
      return 'Your AI account hit its rate limit. Your input is saved; try again shortly.';
    case 'network':
      return 'No connection. Your input is saved on this device — run it again when you are back online.';
    case 'timeout':
      return 'The request took too long. Your input is saved; you can retry.';
    case 'cancelled':
      return 'Run cancelled. Nothing was saved to your journal.';
    case 'contentFiltered':
      return 'The provider declined to answer this request. Try rephrasing what you want to understand.';
    default:
      return 'Something went wrong running this workflow. Your input is saved on this device.';
  }
}
