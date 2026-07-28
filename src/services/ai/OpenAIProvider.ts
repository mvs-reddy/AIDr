/**
 * OpenAI-compatible provider, calling under the *user's own* account.
 *
 * The key lives in Keychain / Android Keystore via expo-secure-store and is read
 * only at request time — it never enters Redux/Zustand state, a log line, a
 * crash report or an exported trace (§9.3).
 */

import type {
  AIProvider, AIEvent, AIErrorCode, ProviderCapabilities, RedactedAIRequest,
} from './AIProvider';
import { safeMessageFor } from './AIProvider';
import { getSecret } from '../persistence/secrets';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

const BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 60_000;

export class OpenAIProvider implements AIProvider {
  private controllers = new Map<string, AbortController>();

  async capabilities(): Promise<ProviderCapabilities> {
    const key = await getSecret('ai.openai.key');
    const models = key ? await this.listModels(key) : [];
    return {
      providerId: 'openai',
      displayName: 'OpenAI',
      models,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      processorRegion: null,
      excludedFromTraining: true, // API traffic is excluded by default policy
    };
  }

  private async listModels(key: string): Promise<string[]> {
    try {
      const res = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id).sort();
    } catch {
      return [];
    }
  }

  cancel(runId: string): void {
    this.controllers.get(runId)?.abort();
    this.controllers.delete(runId);
  }

  async *stream(request: RedactedAIRequest): AsyncGenerator<AIEvent, void, unknown> {
    const key = await getSecret('ai.openai.key');
    if (!key) {
      yield fail('notConfigured', request.model);
      return;
    }

    const controller = new AbortController();
    this.controllers.set(request.runId, controller);
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildSystemPrompt(request) },
            { role: 'user', content: buildUserPrompt(request) },
            ...(request.correction
              ? [{ role: 'system' as const, content: request.correction }]
              : []),
          ],
        }),
      });

      if (!res.ok) {
        yield fail(mapStatus(res.status), request.model);
        return;
      }

      // NO-FALLBACK GUARD (§18.1). If the service answered with a different
      // model than we asked for, that is a policy violation, not a convenience.
      let text = '';
      let modelUsed = request.model;
      let mismatchReported = false;

      for await (const chunk of readSSE(res)) {
        if (chunk === '[DONE]') break;
        let parsed: {
          model?: string;
          choices?: Array<{ delta?: { content?: string } }>;
        };
        try {
          parsed = JSON.parse(chunk);
        } catch {
          continue;
        }

        if (parsed.model) {
          modelUsed = parsed.model;
          if (!mismatchReported && !modelsMatch(request.model, parsed.model)) {
            mismatchReported = true;
            yield fail('modelUnavailable', request.model);
            controller.abort();
            return;
          }
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          yield { type: 'delta', text: delta };
        }
      }

      yield { type: 'done', text, modelUsed };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      yield fail(aborted ? 'cancelled' : 'network', request.model);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(request.runId);
    }
  }
}

/** `gpt-5.6-terra` vs the dated snapshot `gpt-5.6-terra-2026-06-01` is a match. */
function modelsMatch(requested: string, served: string): boolean {
  return served === requested || served.startsWith(`${requested}-`);
}

function fail(code: AIErrorCode, model: string): AIEvent {
  return { type: 'error', code, safeMessage: safeMessageFor(code, model) };
}

function mapStatus(status: number): AIErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'modelUnavailable';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'network';
  return 'unknown';
}

/** Minimal SSE reader. RN's fetch exposes a byte stream on the new architecture. */
async function* readSSE(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const whole = await res.text();
    for (const line of whole.split('\n')) {
      if (line.startsWith('data: ')) yield line.slice(6).trim();
    }
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) yield trimmed.slice(6);
    }
  }
}
