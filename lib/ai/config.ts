import type { AiProvider, GenerateJSONOpts } from './types';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
export const ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const PROVIDERS = new Set<AiProvider>(['gemini', 'openai', 'anthropic']);

function provider(value: string): AiProvider {
  if (!PROVIDERS.has(value as AiProvider)) throw new Error('Invalid AI provider configuration');
  return value as AiProvider;
}

export function providerChain(opts: GenerateJSONOpts): AiProvider[] {
  const suffix = (opts.feature ?? '').replace(/[^a-z0-9]/gi, '_').toUpperCase();
  const primary = provider((suffix && process.env[`AI_PROVIDER_${suffix}`]) || process.env.AI_PRIMARY_PROVIDER || 'gemini');
  if (opts.noFallback) return [primary];
  // Undefined preserves today's optional OpenAI fallback. An empty string disables fallback.
  const fallback = process.env.AI_FALLBACK_PROVIDERS;
  const others = fallback === undefined ? ['openai'] : fallback.split(',').map(value => value.trim()).filter(Boolean);
  return [...new Set([primary, ...others.map(provider)])];
}

export function modelFor(provider: AiProvider, opts: GenerateJSONOpts): string {
  const tutor = opts.feature === 'tutor';
  if (provider === 'gemini') return (tutor && process.env.GEMINI_TUTOR_MODEL) || process.env.GEMINI_MODEL || GEMINI_MODEL;
  if (provider === 'openai') return process.env.OPENAI_MODEL || OPENAI_MODEL;
  // Both tiers intentionally use Sonnet. No cost-based routing in this migration.
  return (tutor && process.env.ANTHROPIC_TUTOR_MODEL) || process.env.ANTHROPIC_MODEL || ANTHROPIC_MODEL;
}

export function keyFor(provider: AiProvider, opts: GenerateJSONOpts): string | undefined {
  if (opts.apiKey) return opts.apiKey;
  const prefix = provider.toUpperCase();
  // Tutor isolation fails closed. Never borrow the platform credential.
  if (opts.feature === 'tutor') return process.env[`${prefix}_TUTOR_API_KEY`];
  return process.env[`${prefix}_API_KEY`];
}

export function isAiFeatureConfigured(feature: string) {
  const opts = { feature, noFallback: true };
  return !!keyFor(providerChain(opts)[0], opts);
}
