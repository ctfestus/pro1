import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateJSON, generateText, generateStream, generateVisionJSON } from '@/lib/ai';

const mocks = vi.hoisted(() => ({ gemini: vi.fn(), geminiStream: vi.fn(), openai: vi.fn(), keys: vi.fn(), claude: vi.fn(), claudeKeys: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  constructor(opts: unknown) { mocks.keys(opts); }
  models = { generateContent: mocks.gemini, generateContentStream: mocks.geminiStream };
} }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.openai } }; } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  constructor(opts: unknown) { mocks.claudeKeys(opts); }
  beta = { messages: { create: mocks.claude } };
} }));

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
  vi.stubEnv('ANTHROPIC_API_KEY', 'claude-platform');
  vi.stubEnv('ANTHROPIC_TUTOR_API_KEY', 'claude-tutor');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('neutral gateway', () => {
  it('accepts schema-less editor JSON for both providers', async () => {
    for (const provider of ['gemini', 'anthropic']) {
      vi.stubEnv('AI_PRIMARY_PROVIDER', provider);
      mocks.gemini.mockResolvedValue(ok(['one']));
      mocks.claude.mockResolvedValue({ content: [{ type: 'text', text: '{"values":["one"]}' }], stop_reason: 'end_turn' });
      await expect(generateJSON('prompt', undefined, { feature: 'ai-assist', retries: 0, noFallback: true })).resolves.toEqual({ values: ['one'] });
    }
  });

  it('still checks JSON syntax, refusals, and truncation for ai-assist', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    for (const [text, stop_reason] of [['not JSON', 'end_turn'], ['{}', 'refusal'], ['{', 'max_tokens']]) {
      mocks.claude.mockResolvedValue({ content: [{ type: 'text', text }], stop_reason });
      await expect(generateJSON('prompt', undefined, { feature: 'ai-assist', retries: 0, noFallback: true })).rejects.toThrow();
    }
    expect(mocks.gemini).not.toHaveBeenCalled();
  });
  it('routes legacy DOC directly to Gemini without using Claude credentials or OpenAI', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.gemini.mockResolvedValue(ok(['one', 'two']));
    for (const feature of ['document-review', 'extract-rubric']) {
      await generateVisionJSON('prompt', { data: 'doc-bytes', mimeType: 'application/msword' }, schema,
        { feature, noFallback: true, apiKey: 'explicit-claude-key' });
    }
    expect(mocks.keys).toHaveBeenCalledWith({ apiKey: 'platform' });
    expect(mocks.claude).not.toHaveBeenCalled();
    expect(mocks.openai).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0][1]))).toMatchObject({ provider: 'gemini', fallbackReason: 'legacy_doc_compatibility' });
  });
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

  it('does not enable Claude for course generation', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    await expect(generateJSON('prompt', schema, { feature: 'ai-course' })).rejects.toThrow('not enabled');
    expect(mocks.gemini).not.toHaveBeenCalled();
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it('falls back to Gemini only for operational Claude failures', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    vi.stubEnv('AI_FALLBACK_PROVIDERS', 'gemini,openai');
    mocks.gemini.mockResolvedValue(ok(['one', 'two']));
    mocks.claude.mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
    await expect(generateJSON('prompt', schema, { feature: 'written-review', retries: 0 })).resolves.toEqual({ values: ['one', 'two'] });
    expect(mocks.gemini).toHaveBeenCalledTimes(1);
    mocks.gemini.mockClear();
    for (const response of [
      { content: [], stop_reason: 'refusal' },
      { content: [{ type: 'text', text: '{"values":["one"]}' }], stop_reason: 'end_turn' },
      { content: [{ type: 'text', text: '{' }], stop_reason: 'max_tokens' },
    ]) {
      mocks.claude.mockResolvedValue(response);
      await expect(generateJSON('prompt', schema, { feature: 'written-review', retries: 0 })).rejects.toThrow();
      expect(mocks.gemini).not.toHaveBeenCalled();
    }
    mocks.claude.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
    await expect(generateJSON('prompt', schema, { feature: 'written-review', retries: 0 })).rejects.toThrow('unavailable');
    expect(mocks.gemini).not.toHaveBeenCalled();
  });

  it('retries cut-off Claude JSON on Claude rather than another provider', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    mocks.claude.mockResolvedValueOnce({ content: [], stop_reason: 'max_tokens' })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"values":["one","two"]}' }], stop_reason: 'end_turn' });
    await expect(generateJSON('prompt', schema, { feature: 'written-review', retries: 1 })).resolves.toEqual({ values: ['one', 'two'] });
    expect(mocks.claude).toHaveBeenCalledTimes(2);
    expect(mocks.openai).not.toHaveBeenCalled();
  });

  it('uses only dedicated tutor credentials across an operational fallback', async () => {
    vi.stubEnv('AI_PROVIDER_TUTOR', 'anthropic');
    mocks.claude.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    mocks.gemini.mockResolvedValue({ text: 'Tutor reply' });
    await expect(generateText('question', { feature: 'tutor', noFallback: true, retries: 0 })).resolves.toBe('Tutor reply');
    expect(mocks.claudeKeys).toHaveBeenCalledWith({ apiKey: 'claude-tutor', maxRetries: 0 });
    expect(mocks.keys).toHaveBeenCalledWith({ apiKey: 'tutor' });
    expect(mocks.openai).not.toHaveBeenCalled();
    vi.stubEnv('ANTHROPIC_TUTOR_API_KEY', '');
    mocks.claude.mockClear();
    await expect(generateText('question', { feature: 'tutor', noFallback: true })).resolves.toBe('Tutor reply');
    expect(mocks.claude).not.toHaveBeenCalled();
  });

  it('logs every server fallback iteration without logging model content', async () => {
    vi.stubEnv('AI_PRIMARY_PROVIDER', 'anthropic');
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.claude.mockResolvedValue({
      model: 'served-fallback-model', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '{"values":["one","two"]}' }],
      usage: { iterations: [
        { type: 'message', model: 'claude-sonnet-5-5', input_tokens: 20, output_tokens: 5 },
        { type: 'fallback_message', model: 'served-fallback-model', input_tokens: 25, output_tokens: 15 },
      ] },
    });
    await generateJSON('private prompt', schema, { feature: 'written-review' });
    const events = log.mock.calls.map(call => JSON.parse(String(call[1])));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ model: 'claude-sonnet-5-5', finishReason: 'refusal', inputTokens: 20, outputTokens: 5 });
    expect(events[1]).toMatchObject({ model: 'served-fallback-model', finishReason: 'end_turn', fallbackReason: 'anthropic_refusal_fallback', outputTokens: 15 });
    expect(JSON.stringify(events)).not.toContain('private');
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
