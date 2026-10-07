import { describe, expect, it, vi } from 'vitest';
import { buildAiUsageEvent, logAiUsage } from '@/lib/ai-usage';

describe('AI usage telemetry', () => {
  it('records Claude thinking, cache usage, latency, feature and fallback without double billing thinking', () => {
    const event = buildAiUsageEvent({
      provider: 'anthropic', model: 'claude-sonnet-5-5',
      context: { operation: 'lesson-tutor', feature: 'tutor', latencyMs: 250, attempt: 2, fallbackReason: 'transient_or_invalid_output' },
      response: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'private student content' }], usage: {
        input_tokens: 1000, output_tokens: 500, output_tokens_details: { thinking_tokens: 200 },
        cache_read_input_tokens: 3000, cache_creation_input_tokens: 2000,
        cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 1000 },
      } },
    });
    expect(event).toMatchObject({
      feature: 'tutor', latencyMs: 250, attempt: 2, thinkingTokens: 200, inputTokens: 1000,
      cachedTokens: 3000, cacheWriteTokens: 2000, totalTokens: 6500, estimatedCostUsd: 0.0141,
      fallbackReason: 'transient_or_invalid_output', finishReason: 'end_turn',
    });
    expect(JSON.stringify(event)).not.toContain('private student content');
  });

  it('keeps missing usage values unknown rather than reporting zero spend', () => {
    const event = buildAiUsageEvent({ provider: 'anthropic', model: 'claude-sonnet-5-5', response: {}, context: { operation: 'test' } });
    expect(event.inputTokens).toBeNull();
    expect(event.outputTokens).toBeNull();
    expect(event.estimatedCostUsd).toBeNull();
  });
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

  it('never throws when a usage event cannot be serialized', () => {
    const circular: any = {};
    circular.self = circular;

    expect(() => logAiUsage({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      context: { operation: 'document-review', metadata: circular },
      response: { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
    })).not.toThrow();
  });
});
