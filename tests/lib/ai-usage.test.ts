import { describe, expect, it, vi } from 'vitest';
import { buildAiUsageEvent, logAiUsage } from '@/lib/ai-usage';

describe('AI usage telemetry', () => {
  it('normalizes Gemini usage, finish reason, modalities, and estimated cost', () => {
    const event = buildAiUsageEvent({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      context: { operation: 'document-review', metadata: { fileBytes: 1200 } },
      response: {
        usageMetadata: {
          promptTokenCount: 10_000,
          candidatesTokenCount: 1_000,
          thoughtsTokenCount: 500,
          cachedContentTokenCount: 2_000,
          totalTokenCount: 11_500,
          promptTokensDetails: [{ modality: 'DOCUMENT', tokenCount: 5_000 }],
        },
        candidates: [{ finishReason: 'STOP' }],
      },
    });

    expect(event).toMatchObject({
      operation: 'document-review',
      provider: 'gemini',
      finishReason: 'STOP',
      inputTokens: 10_000,
      outputTokens: 1_000,
      thinkingTokens: 500,
      cachedTokens: 2_000,
      totalTokens: 11_500,
      estimatedCostUsd: 0.0258,
      pricingBasis: 'standard_paid_list',
      pricingAsOf: '2026-09-08',
      metadata: { fileBytes: 1200 },
    });
    expect(event.inputModalities).toEqual([{ modality: 'DOCUMENT', tokens: 5_000 }]);
  });

  it('does not double-count OpenAI reasoning tokens in completion usage', () => {
    const event = buildAiUsageEvent({
      provider: 'openai',
      model: 'gpt-4o-mini',
      context: { operation: 'excel-review', attempt: 2 },
      response: {
        usage: {
          prompt_tokens: 2_000,
          completion_tokens: 1_000,
          total_tokens: 3_000,
          prompt_tokens_details: { cached_tokens: 500 },
          completion_tokens_details: { reasoning_tokens: 300 },
        },
        choices: [{ finish_reason: 'stop' }],
      },
    });

    expect(event).toMatchObject({
      attempt: 2,
      finishReason: 'stop',
      thinkingTokens: 300,
      estimatedCostUsd: 0.0008625,
    });
  });

  it('logs token counts for unknown models without inventing a price', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logAiUsage({
      provider: 'gemini',
      model: 'custom-model',
      context: { operation: 'written-review' },
      response: { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
    });

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0][1]));
    expect(payload.estimatedCostUsd).toBeNull();
    expect(payload.inputTokens).toBe(10);
    info.mockRestore();
  });

  it('stays silent when a caller does not opt into usage telemetry', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logAiUsage({ provider: 'gemini', model: 'gemini-3.5-flash', response: {} });
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
