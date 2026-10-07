import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiParameters, geminiAdapter } from '@/lib/ai/adapters/gemini';
import { openaiParameters, openaiAdapter } from '@/lib/ai/adapters/openai';
import { anthropicParameters, anthropicAdapter } from '@/lib/ai/adapters/anthropic';
import { CLAUDE_FEATURES, keyFor, modelFor, providerChain } from '@/lib/ai/config';
import { MAX_OUTPUT_TOKENS } from '@/lib/lesson-tutor';
import type { AiRequest } from '@/lib/ai/types';

const mocks = vi.hoisted(() => ({
  geminiCreate: vi.fn(), googleConstructor: vi.fn(),
  openaiCreate: vi.fn(), openaiConstructor: vi.fn(),
  claudeCreate: vi.fn(), claudeConstructor: vi.fn(),
}));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  constructor(opts: unknown) { mocks.googleConstructor(opts); }
  models = { generateContent: mocks.geminiCreate };
} }));
vi.mock('openai', () => ({ default: class {
  constructor(opts: unknown) { mocks.openaiConstructor(opts); }
  chat = { completions: { create: mocks.openaiCreate } };
} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  constructor(opts: unknown) { mocks.claudeConstructor(opts); }
  beta = { messages: { create: mocks.claudeCreate } };
} }));

const request = (opts: AiRequest['opts'] = {}): AiRequest => ({
  prompt: 'Return a JSON result', json: true,
  schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
  opts: { feature: 'ai-course', temperature: 0.4, effort: 'low', ...opts },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash');
  vi.stubEnv('OPENAI_MODEL', 'gpt-4o-mini');
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-5');
  vi.stubEnv('AI_PRIMARY_PROVIDER', 'gemini');
  vi.stubEnv('AI_FALLBACK_PROVIDERS', 'openai');
  vi.stubEnv('AI_PROVIDER_TUTOR', 'gemini');
});
afterEach(() => vi.unstubAllEnvs());

describe('provider selection and isolation', () => {
  it('supports a feature override, deduplicates fallbacks, and respects noFallback', () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'openai');
    vi.stubEnv('AI_FALLBACK_PROVIDERS', 'gemini,openai,gemini');
    expect(providerChain({ feature: 'tutor' })).toEqual(['gemini']);
    expect(providerChain({ feature: 'tutor', noFallback: true })).toEqual(['gemini']);
    expect(providerChain({ feature: 'ai-course' })).toEqual(['openai', 'gemini']);
    vi.stubEnv('AI_FALLBACK_PROVIDERS', '');
    expect(providerChain({ feature: 'ai-course' })).toEqual(['openai']);
  });

  it('does not silently replace invalid provider configuration', () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'typo');
    expect(() => providerChain({})).toThrow('Invalid AI provider configuration');
  });

  it('resolves tutor keys independently and never borrows the platform key', () => {
    vi.stubEnv('GEMINI_API_KEY', 'platform');
    vi.stubEnv('GEMINI_TUTOR_API_KEY', '');
    expect(keyFor('gemini', { feature: 'tutor' })).toBe('');
    vi.stubEnv('GEMINI_TUTOR_API_KEY', 'tutor');
    expect(keyFor('gemini', { feature: 'tutor' })).toBe('tutor');
    expect(keyFor('gemini', { apiKey: 'override' })).toBe('override');
  });

  it('maps both tiers and the tutor to Sonnet', () => {
    for (const tier of ['fast', 'standard'] as const) {
      expect(modelFor('anthropic', { tier })).toBe('claude-sonnet-5-5');
      expect(modelFor('anthropic', { tier, feature: 'tutor' })).toBe('claude-sonnet-5-5');
    }
  });

  it('limits Claude to approved features and keeps tutor fallback isolated', () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    for (const feature of ['ai-course', 'ai-guided-project', 'doc-course-extract', 'generate']) {
      expect(providerChain({ feature })).toEqual(['gemini', 'openai']);
      expect(providerChain({ feature, noFallback: true })).toEqual(['gemini']);
    }
    expect(providerChain({ feature: 'excel-review' })).toEqual(['anthropic', 'openai']);
    vi.stubEnv('AI_PROVIDER_TUTOR', 'anthropic');
    expect(providerChain({ feature: 'tutor', noFallback: true })).toEqual(['anthropic', 'gemini']);
    vi.stubEnv('ANTHROPIC_API_KEY', 'platform');
    vi.stubEnv('ANTHROPIC_TUTOR_API_KEY', '');
    expect(keyFor('anthropic', { feature: 'tutor' })).toBe('');
  });
});

describe('adapter parameter mapping', () => {
  it('omits absent or blank system instructions and preserves nonempty instructions', () => {
    for (const systemInstruction of [undefined, '', '   ']) {
      expect(geminiParameters(request({ systemInstruction })).config).not.toHaveProperty('systemInstruction');
      expect(anthropicParameters(request({ systemInstruction }))).not.toHaveProperty('system');
    }
    const systemInstruction = 'Review the attached document.';
    expect(geminiParameters(request({ systemInstruction })).config.systemInstruction).toBe(systemInstruction);
    expect(anthropicParameters(request({ systemInstruction })).system).toBe(systemInstruction);
  });

  it('preserves Gemini temperature, thinking, and output ceilings', () => {
    expect(geminiParameters(request({ maxOutputTokens: 900 })).config).toMatchObject({
      temperature: 0.4, maxOutputTokens: 900, thinkingConfig: { thinkingLevel: 'LOW' },
      responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' },
    });
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.0-flash');
    expect(geminiParameters(request()).config).not.toHaveProperty('thinkingConfig');
  });

  it('uses the resolved tutor model for the Gemini capability gate', () => {
    vi.stubEnv('GEMINI_TUTOR_MODEL', 'gemini-2.0-flash');
    expect(geminiParameters(request({ feature: 'tutor' })).config).not.toHaveProperty('thinkingConfig');
    vi.stubEnv('GEMINI_TUTOR_MODEL', 'gemini-3.1-flash-lite');
    expect(geminiParameters(request({ feature: 'tutor' }))).toMatchObject({
      model: 'gemini-3.1-flash-lite', config: { thinkingConfig: { thinkingLevel: 'LOW' } },
    });
    vi.stubEnv('GEMINI_TUTOR_MODEL', '');
    expect(geminiParameters(request({ feature: 'tutor' })).model).toBe('gemini-3.5-flash');
  });

  it('drops Sonnet temperature, explicitly maps effort, and always sets max_tokens', () => {
    const params = anthropicParameters(request());
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(params).toMatchObject({ max_tokens: 8192, output_config: { effort: 'low' } });
    expect(anthropicParameters(request({ maxOutputTokens: 900, effort: 'minimal' }))).toMatchObject({
      max_tokens: 900, output_config: { effort: 'low' },
    });
  });

  it('retains Haiku temperature and omits its unsupported effort control', () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001');
    const params = anthropicParameters(request());
    expect(params.temperature).toBe(0.4);
    expect(params.output_config).not.toHaveProperty('effort');
    expect(params).not.toHaveProperty('thinking');
  });

  it('sets feature effort, output headroom, and the server refusal fallback beta', () => {
    for (const feature of ['excel-review', 'code-review', 'document-review', 'written-review', 'dashboard-critique', 've-answer-review', 've-instructor-review-draft', 'extract-rubric']) {
      const params = anthropicParameters(request({ feature, effort: 'low' }));
      expect(params.output_config.effort).toBe('medium');
      expect(params.max_tokens).toBeGreaterThanOrEqual(4096);
      expect(params.fallbacks).toBe('default');
      expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    }
    for (const feature of ['ai-assist', 'tutor']) {
      expect(anthropicParameters(request({ feature })).output_config.effort).toBe('low');
    }
  });

  it('uses the shared tutor reply limit without a duplicate Claude setting', () => {
    expect(CLAUDE_FEATURES.tutor).toEqual({ effort: 'low' });
    const opts = { feature: 'tutor', maxOutputTokens: MAX_OUTPUT_TOKENS };
    expect(geminiParameters(request(opts)).config.maxOutputTokens).toBe(2048);
    expect(anthropicParameters(request(opts)).max_tokens).toBe(2048);
  });

  it('maps PDFs and images separately and rejects Office binaries', () => {
    const base = request();
    expect(anthropicParameters({ ...base, asset: { data: 'a', mimeType: 'application/pdf' } }).messages[0].content[1].type).toBe('document');
    expect(anthropicParameters({ ...base, asset: { data: 'a', mimeType: 'image/png' } }).messages[0].content[1].type).toBe('image');
    expect(() => anthropicParameters({ ...base, asset: { data: 'a', mimeType: 'application/msword' } })).toThrow();
    expect(() => openaiParameters({ ...base, asset: { data: 'a', mimeType: 'application/pdf' } })).toThrow();
  });

  it('preserves OpenAI JSON mode and supplies the schema without leaking vendor options', () => {
    const params = openaiParameters(request({ maxOutputTokens: 700 }));
    expect(params).toMatchObject({ temperature: 0.4, max_tokens: 700, response_format: { type: 'json_object' } });
    expect(params).not.toHaveProperty('effort');
    expect(params.messages.at(-1)?.content).toContain('schema');
  });

  it('disables SDK retries and reads only Claude text blocks', async () => {
    mocks.claudeCreate.mockResolvedValue({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '{"result":"ok"}' }], stop_reason: 'end_turn' });
    const result = await anthropicAdapter.generate(request({ apiKey: 'claude-key' }));
    expect(mocks.claudeConstructor).toHaveBeenCalledWith({ apiKey: 'claude-key', maxRetries: 0 });
    expect(result.text).toBe('{"result":"ok"}');
    mocks.openaiCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    await openaiAdapter.generate(request({ apiKey: 'openai-key' }));
    expect(mocks.openaiConstructor).toHaveBeenCalledWith({ apiKey: 'openai-key', maxRetries: 0 });
  });

  it('maps truncation and refusal stop reasons without returning a fabricated result', async () => {
    mocks.claudeCreate.mockResolvedValue({ content: [], stop_reason: 'refusal' });
    expect(await anthropicAdapter.generate(request({ apiKey: 'key' }))).toMatchObject({ refused: true });
    mocks.claudeCreate.mockResolvedValue({ content: [], stop_reason: 'max_tokens' });
    expect(await anthropicAdapter.generate(request({ apiKey: 'key' }))).toMatchObject({ truncated: true });
    mocks.geminiCreate.mockResolvedValue({ text: '{}', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    expect(await geminiAdapter.generate(request({ apiKey: 'key' }))).toMatchObject({ truncated: true });
  });
});
