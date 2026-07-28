/**
 * Optional developer audit traces (spec §5.7).
 *
 * Off by default. When enabled, each completed run appends a timestamped JSONL
 * line to a private dataset the user controls. The trace carries the *redacted*
 * payload hash, the model, timings and the validation outcome — never the
 * prompt body, never health values, never the raw note.
 */

import { getSecret } from '../persistence/secrets';
import type { WorkflowKind } from '../../domain/models';

export interface TraceRecord {
  at: string;
  workflow: WorkflowKind;
  model: string;
  payloadHash: string;
  latencyMs: number;
  validationPassed: boolean;
  violations: string[];
  retries: number;
  redactionEngine: string;
  spansRedacted: number;
  safetyPolicyVersion: string;
}

export async function appendTrace(dataset: string, record: TraceRecord): Promise<boolean> {
  const token = await getSecret('audit.huggingface.token');
  if (!token || !dataset) return false;

  // Guard: refuse to transmit anything that looks like content rather than a hash.
  const serialised = JSON.stringify(record);
  if (serialised.length > 2_000) return false;

  try {
    const res = await fetch(
      `https://huggingface.co/api/datasets/${encodeURIComponent(dataset)}/upload/main/traces.jsonl`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: `${serialised}\n`,
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
