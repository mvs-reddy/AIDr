import { z } from 'zod';
import type { AIWorkflowOutput } from '../models';

export const OUTPUT_SCHEMA_VERSION = '1.2.0';

const ObservationSchema = z.object({
  statement: z.string().min(1).max(400),
  evidenceRefs: z.array(z.string().min(3)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const WorkflowOutputSchema = z.object({
  headline: z.string().min(1).max(120),
  summary: z.array(z.string().max(400)).max(6),
  observations: z.array(ObservationSchema).max(8),
  questionsForClinician: z.array(z.string().max(300)).max(8),
  uncertainties: z.array(z.string().max(300)).max(6),
  urgentSafetyMessage: z.string().max(600).nullable(),
  disclaimer: z.string().min(20),
  schemaVersion: z.string().default(OUTPUT_SCHEMA_VERSION),
});

export type ParseResult =
  | { ok: true; value: AIWorkflowOutput }
  | { ok: false; issue: string };

/**
 * Strict parse. Models occasionally wrap JSON in prose or fences; we recover the
 * outermost object rather than failing the run, but we never repair *contents*.
 */
export function parseWorkflowOutput(raw: string): ParseResult {
  const candidate = extractJSON(raw);
  if (!candidate) return { ok: false, issue: 'No JSON object found in the response.' };

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return { ok: false, issue: 'Response was not valid JSON.' };
  }

  const result = WorkflowOutputSchema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, issue: `${first.path.join('.') || 'root'}: ${first.message}` };
  }
  return { ok: true, value: result.data as AIWorkflowOutput };
}

function extractJSON(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/**
 * Evidence refs must resolve against context actually supplied to the model.
 * A hallucinated `signal:hrv:7d` for a user who never authorised HRV is a
 * fabricated observation, so the run is rejected (§18.1).
 */
export function evidenceRefsResolve(
  output: AIWorkflowOutput,
  availableRefs: Set<string>,
): { ok: boolean; unknown: string[] } {
  const unknown = output.observations
    .flatMap((o) => o.evidenceRefs)
    .filter((r) => !availableRefs.has(r));
  return { ok: unknown.length === 0, unknown: [...new Set(unknown)] };
}
