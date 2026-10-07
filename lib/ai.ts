import { logAiUsage } from '@/lib/ai-usage';
import { geminiAdapter } from './ai/adapters/gemini';
import { openaiAdapter } from './ai/adapters/openai';
import { anthropicAdapter } from './ai/adapters/anthropic';
import { keyFor, modelFor, providerChain } from './ai/config';
import { AiValidationError, validateAiResult } from './ai/schema';
import type { AiAdapter, AiProvider, AiRequest, AiResult, GenerateJSONOpts, JsonSchema } from './ai/types';

export type { GenerateJSONOpts, JsonSchema } from './ai/types';
export { isAiFeatureConfigured } from './ai/config';

const FORMATTING_SYSTEM_INSTRUCTION =
  'Plain ASCII only. Never use: em dashes (--), en dashes (-), ' +
  'curly/smart quotes, ellipsis characters, ' +
  'or any other non-ASCII typographic character. ' +
  'Use straight double quotes (") and straight apostrophes (\') only. ' +
  'Use a plain hyphen (-) where a dash is needed. ' +
  'Do not open any sentence with filler phrases such as "Certainly!", "Absolutely!", "Of course!", or "Great!". ' +
  'Write plainly and directly.';

const adapters: Record<AiProvider, AiAdapter> = { gemini: geminiAdapter, openai: openaiAdapter, anthropic: anthropicAdapter };

class AiRefusalError extends Error { constructor() { super('AI provider declined the request'); } }
class AiTruncationError extends Error { constructor() { super('AI response truncated'); } }

export function isOperationalAiError(err: unknown) {
  const error = err as { status?: number; name?: string; message?: string; cause?: { code?: string } };
  if (error?.status !== undefined) return error.status === 408 || error.status === 429 || error.status >= 500;
  if (['APIConnectionError', 'APIConnectionTimeoutError'].includes(error?.name ?? '')) return true;
  return /overloaded|unavailable|high demand|fetch failed|econnreset|etimedout|timeout/i.test(error?.message ?? '') ||
    ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(error?.cause?.code ?? '');
}

export function isRetryableAiError(err: unknown) {
  if (isOperationalAiError(err)) return true;
  if (err instanceof SyntaxError || err instanceof AiValidationError || err instanceof AiTruncationError) return true;
  const error = err as { status?: number; message?: string; cause?: { code?: string; message?: string } };
  const message = String(error?.message ?? '').toLowerCase();
  return error?.status === 429 || (error?.status ?? 0) >= 500 ||
    ['unavailable', 'overloaded', 'high demand', '"code":503', '503 ', 'fetch failed', 'econnreset', 'truncated', 'timeout'].some(value => message.includes(value)) ||
    String(error?.cause?.message ?? '').toLowerCase().includes('econnreset') || error?.cause?.code === 'ECONNRESET';
}

function normalized(request: AiRequest): AiRequest {
  const feature = request.opts.feature ?? request.opts.usageContext?.operation ?? 'unspecified';
  return { ...request, opts: {
    ...request.opts, feature,
    systemInstruction: request.opts.systemInstruction ?? FORMATTING_SYSTEM_INSTRUCTION,
    usageContext: request.opts.usageContext ?? { operation: feature },
  } };
}

function finish(request: AiRequest, result: AiResult): any {
  if (result.refused) throw new AiRefusalError();
  if (request.json && result.truncated) throw new AiTruncationError();
  if (!request.json) {
    if (!result.text.trim()) throw new Error('AI provider returned an empty response');
    return result.text.trim();
  }
  const parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
  validateAiResult(request.schema, parsed);
  return parsed;
}

function logCall(request: AiRequest, provider: AiProvider, result: AiResult | undefined, started: number, attempt: number, fallbackReason?: string) {
  const iterations = provider === 'anthropic' ? result?.response?.usage?.iterations : undefined;
  if (Array.isArray(iterations) && iterations.length) {
    for (const [index, usage] of iterations.entries()) {
      logAiUsage({ provider, model: usage.model ?? result!.model, response: {
        usage, stop_reason: index === iterations.length - 1 ? result!.response.stop_reason : 'refusal',
      }, context: { ...request.opts.usageContext!, feature: request.opts.feature, latencyMs: Date.now() - started,
        attempt, fallbackReason: usage.type === 'fallback_message' ? 'anthropic_refusal_fallback' : fallbackReason } });
    }
    return;
  }
  logAiUsage({ provider, model: result?.model ?? modelFor(provider, request.opts), response: result?.response ?? {}, context: {
    ...request.opts.usageContext!, feature: request.opts.feature,
    latencyMs: Date.now() - started, attempt, fallbackReason,
  } });
}

async function generate(raw: AiRequest): Promise<any> {
  let request = normalized(raw);
  let chain = providerChain(request.opts);
  // Compatibility routing happens before any model call, not after a refusal.
  const legacyDoc = request.asset?.mimeType === 'application/msword' &&
    ['document-review', 'extract-rubric'].includes(request.opts.feature ?? '') && chain[0] !== 'gemini';
  if (legacyDoc) {
    chain = ['gemini'];
    request = { ...request, opts: { ...request.opts, apiKey: undefined } };
  }
  let lastError: unknown;
  let fallbackReason: string | undefined = legacyDoc ? 'legacy_doc_compatibility' : undefined;
  for (const [index, provider] of chain.entries()) {
    const adapter = adapters[provider];
    // Explicit credentials belong to the selected primary, never another vendor's fallback.
    const current = index ? { ...request, opts: { ...request.opts, apiKey: undefined } } : request;
    if (provider === 'anthropic' && current.opts.feature === 'tutor' && !keyFor(provider, current.opts)) {
      fallbackReason = 'missing_tutor_credential';
      continue;
    }
    if (index && !keyFor(provider, current.opts)) continue;
    const defaultRetries = provider === 'gemini' ? current.asset ? 0 : 1 : 2;
    const retries = Math.max(0, index ? defaultRetries : current.opts.retries ?? defaultRetries);
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      const started = Date.now();
      const reason = index || legacyDoc ? fallbackReason : undefined;
      let result: AiResult | undefined;
      try {
        result = await adapter.generate(current);
        return finish(current, result);
      } catch (err) {
        lastError = err;
        if (err instanceof AiRefusalError) throw err;
        fallbackReason = isRetryableAiError(err) ? 'transient_or_invalid_output' : 'provider_error';
        if (attempt > retries || !isRetryableAiError(err)) break;
      } finally {
        logCall(current, provider, result, started, attempt, reason);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
    // JSON failures retry on Claude, but never bypass a refusal/invalid output by changing vendors.
    if (provider === 'anthropic' && !isOperationalAiError(lastError)) break;
  }
  if (lastError instanceof AiValidationError || lastError instanceof AiTruncationError) throw lastError;
  // Vendor error payloads can contain generated text. Route logs receive a safe message only.
  throw new Error('AI service unavailable. Please try again.');
}

export async function generateText(prompt: string, opts: GenerateJSONOpts = {}): Promise<string> {
  return generate({ prompt, opts, json: false });
}

export async function generateJSON(prompt: string, schema?: JsonSchema, opts: GenerateJSONOpts = {}): Promise<any> {
  return generate({ prompt, schema, opts, json: true });
}

export async function generateVisionJSON(prompt: string, asset: { data: string; mimeType: string }, schema?: JsonSchema, opts: GenerateJSONOpts = {}): Promise<any> {
  return generate({ prompt, asset, schema, opts, json: true });
}

/** Existing document extraction behind the vendor boundary; parsing changes come later. */
export async function generateDocumentText(prompt: string, asset: { data: string; mimeType: string }, opts: GenerateJSONOpts = {}): Promise<string> {
  return generate({ prompt, asset, json: false, opts });
}

export async function generateStream(prompt: string, schema?: JsonSchema, opts: GenerateJSONOpts = {}): Promise<ReadableStream<Uint8Array>> {
  const request = normalized({ prompt, schema, opts, json: true });
  const encoder = new TextEncoder();
  const chain = providerChain(request.opts);
  let fallbackReason: string | undefined;
  for (const [index, provider] of chain.entries()) {
    const adapter = adapters[provider];
    const current = index ? { ...request, opts: { ...request.opts, apiKey: undefined } } : request;
    if (index && !keyFor(provider, current.opts)) continue;
    const started = Date.now();
    try {
      const stream = await adapter.stream(current);
      return new ReadableStream({
        async start(controller) {
          let result: AiResult | undefined;
          try {
            for await (const text of stream.chunks) controller.enqueue(encoder.encode(text));
            result = await stream.final();
            finish(current, result);
            controller.close();
          } catch {
            // Already emitted bytes cannot be replaced with another JSON document.
            controller.error(new Error('Generation failed. Please try again.'));
          } finally {
            logCall(current, provider, result, started, 1, fallbackReason);
          }
        },
      });
    } catch {
      logCall(current, provider, undefined, started, 1, fallbackReason);
      fallbackReason = 'stream_start_failed';
    }
  }
  throw new Error('Generation failed. Please try again.');
}
