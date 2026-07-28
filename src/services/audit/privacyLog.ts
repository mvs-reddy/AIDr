/**
 * The privacy ledger (spec §5.7, §9.1, Android §11).
 *
 * Every AI run appends one row describing what left the device and what stayed.
 * The row records a *hash* of the payload, never the payload — the ledger must
 * not become a second copy of the thing it is auditing.
 */

import { privacyRepo, newId } from '../persistence/db';
import type { PrivacyLogEntry, WorkflowKind } from '../../domain/models';

export interface RecordInput {
  workflow: WorkflowKind | 'dailyRead';
  categories: string[];
  destination: 'onDevice' | 'cloudProvider';
  redactionEngine: string;
  spansRedacted: number;
  payloadHash: string | null;
}

export const privacyLog = {
  async record(input: RecordInput): Promise<PrivacyLogEntry> {
    const entry: PrivacyLogEntry = {
      id: newId(),
      at: new Date().toISOString(),
      ...input,
    };
    await privacyRepo.append(entry);
    return entry;
  },
  list: privacyRepo.list,
};

/** Human summary for the Settings row, e.g. "12 runs · 9 stayed on device". */
export async function privacySummary(): Promise<{ total: number; local: number; cloud: number }> {
  const rows = await privacyRepo.list(500);
  const cloud = rows.filter((r) => r.destination === 'cloudProvider').length;
  return { total: rows.length, local: rows.length - cloud, cloud };
}
