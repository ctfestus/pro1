import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent, openaiCreate } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  openaiCreate: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent }; },
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

vi.mock('openai', () => ({
  default: class { chat = { completions: { create: openaiCreate } }; },
}));

import { generateJSON } from '@/lib/ai';

// Gemini sheds load with this exact shape. Until it was classified retryable it ended the call.
const overloaded = () => new Error(JSON.stringify({
  error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' },
}));

const ok = (payload: unknown) => ({ text: JSON.stringify(payload), candidates: [{ finishReason: 'STOP' }] });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

describe('generateJSON retry behaviour', () => {
  it('retries a 503 and returns the second response without touching the fallback', async () => {
    generateContent.mockRejectedValueOnce(overloaded()).mockResolvedValueOnce(ok({ criteria: ['a'] }));

    await expect(generateJSON('prompt')).resolves.toEqual({ criteria: ['a'] });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it('honours the caller retry budget before giving up', async () => {
    generateContent
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValueOnce(ok({ criteria: ['b'] }));

    await expect(generateJSON('prompt', undefined, { geminiRetries: 2 })).resolves.toEqual({ criteria: ['b'] });
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('retries an overloaded model reported without a status code', async () => {
    generateContent.mockRejectedValueOnce(new Error('The model is overloaded. Please try again later.'))
      .mockResolvedValueOnce(ok({ ok: true }));

    await expect(generateJSON('prompt')).resolves.toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permission failure, and falls back instead', async () => {
    // A denied project stays denied -- retrying it just burns the request budget.
    generateContent.mockRejectedValue(new Error(JSON.stringify({
      error: { code: 403, message: 'Your project has been denied access.', status: 'PERMISSION_DENIED' },
    })));
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: '{"criteria":["fallback"]}' } }] });

    await expect(generateJSON('prompt')).resolves.toEqual({ criteria: ['fallback'] });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back to OpenAI when every retry is exhausted', async () => {
    generateContent.mockRejectedValue(overloaded());
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: '{"criteria":["fallback"]}' } }] });

    await expect(generateJSON('prompt')).resolves.toEqual({ criteria: ['fallback'] });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });
});
