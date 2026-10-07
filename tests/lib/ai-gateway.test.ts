import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateJSON, generateText, generateStream, generateVisionJSON } from '@/lib/ai';

const mocks = vi.hoisted(() => ({ gemini: vi.fn(), geminiStream: vi.fn(), openai: vi.fn(), keys: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  constructor(opts: unknown) { mocks.keys(opts); }
  models = { generateContent: mocks.gemini, generateContentStream: mocks.geminiStream };
} }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.openai } }; } }));

const schema = { type: 'object', properties: { values: { type: 'array', minItems: 2, items: { type: 'string' } } }, required: ['values'] };
const ok = (values: string[]) => ({ text: JSON.stringify({ values }), candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AI_PRIMARY_PROVIDER', 'gemini');
  vi.stubEnv('AI_FALLBACK_PROVIDERS', 'openai');
  vi.stubEnv('AI_PROVIDER_TUTOR', 'gemini');
  vi.stubEnv('GEMINI_API_KEY', 'platform');
  vi.stubEnv('GEMINI_TUTOR_API_KEY', 'tutor');
  vi.stubEnv('OPENAI_API_KEY', 'fallback');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('neutral gateway', () => {
  it('validates primary and fallback results against the original schema', async () => {
    mocks.gemini.mockResolvedValue(ok(['one']));
    mocks.openai.mockResolvedValue({ choices: [{ message: { content: '{"values":["one","two"]}' } }] });
    await expect(generateJSON('private prompt', schema, { feature: 'grading', retries: 0 })).resolves.toEqual({ values: ['one', 'two'] });
    expect(mocks.gemini).toHaveBeenCalledTimes(1);
    expect(mocks.openai).toHaveBeenCalledTimes(1);
    mocks.openai.mockResolvedValue({ choices: [{ message: { content: '{"values":["one"]}' } }] });
    await expect(generateJSON('private prompt', schema, { feature: 'grading', retries: 0 })).rejects.toThrow('response schema');
  });

  it('preserves tutor isolation, output limits and noFallback', async () => {
    mocks.gemini.mockRejectedValue(new Error('overloaded'));
    await expect(generateText('student question', { feature: 'tutor', noFallback: true, retries: 0, maxOutputTokens: 900 })).rejects.toThrow('unavailable');
    expect(mocks.keys).toHaveBeenCalledWith({ apiKey: 'tutor' });
    expect(mocks.gemini.mock.calls[0][0].config.maxOutputTokens).toBe(900);
    expect(mocks.openai).not.toHaveBeenCalled();
    vi.stubEnv('GEMINI_TUTOR_API_KEY', '');
    mocks.keys.mockClear();
    await expect(generateText('question', { feature: 'tutor', noFallback: true, retries: 0 })).rejects.toThrow('unavailable');
    expect(mocks.keys).not.toHaveBeenCalled();
  });

  it('logs each call and fallback reason without prompt, answer or vendor error contents', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.gemini.mockRejectedValue(new Error('private vendor payload'));
    mocks.openai.mockResolvedValue({ choices: [{ message: { content: '{"values":["private answer","two"]}' } }], usage: { prompt_tokens: 30, completion_tokens: 15 } });
    await generateJSON('private student prompt', schema, { feature: 'grading', retries: 0, usageContext: { operation: 'written-review' } });
    const events = log.mock.calls.map(call => JSON.parse(String(call[1])));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ feature: 'grading', provider: 'gemini', attempt: 1 });
    expect(events[1]).toMatchObject({ feature: 'grading', provider: 'openai', attempt: 1, fallbackReason: 'provider_error', inputTokens: 30 });
    expect(events.every(event => event.latencyMs >= 0)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('does not enable Claude production calls in step 1', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    await expect(generateJSON('prompt', schema)).rejects.toThrow('step 3');
    expect(mocks.gemini).not.toHaveBeenCalled();
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it('honors feature overrides without changing the exported API', async () => {
    vi.stubEnv('AI_PROVIDER_GRADING', 'openai');
    mocks.openai.mockResolvedValue({ choices: [{ message: { content: '{"values":["one","two"]}' } }] });
    await generateJSON('prompt', schema, { feature: 'grading' });
    expect(mocks.gemini).not.toHaveBeenCalled();
    expect(mocks.openai).toHaveBeenCalledTimes(1);
  });

  it('keeps binary-document vision inputs on the Gemini adapter', async () => {
    mocks.gemini.mockResolvedValue(ok(['one', 'two']));
    await generateVisionJSON('prompt', { data: 'base64', mimeType: 'application/pdf' }, schema, { feature: 'document-review' });
    expect(mocks.gemini.mock.calls[0][0].contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'base64' } });
  });

  it('preserves progressive JSON streaming and validates its final result', async () => {
    const response = ok(['one', 'two']);
    mocks.geminiStream.mockResolvedValue((async function* () {
      yield { text: '{"values":["one",' };
      yield { ...response, text: '"two"]}' };
    })());
    const stream = await generateStream('prompt', schema, { feature: 'generate' });
    expect(await new Response(stream).json()).toEqual({ values: ['one', 'two'] });
  });

  it('does not concatenate a fallback response after stream bytes have been emitted', async () => {
    mocks.geminiStream.mockResolvedValue((async function* () { yield { text: '{"values":' }; throw new Error('private error'); })());
    const stream = await generateStream('prompt', schema, { feature: 'generate' });
    await expect(new Response(stream).text()).rejects.toThrow('Generation failed');
    expect(mocks.openai).not.toHaveBeenCalled();
  });
});
