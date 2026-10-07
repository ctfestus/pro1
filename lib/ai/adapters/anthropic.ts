import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_FEATURES, keyFor, modelFor } from '../config';
import { toAnthropicSchema } from '../schema';
import type { AiAdapter, AiRequest, AiResult } from '../types';

export function anthropicParameters(request: AiRequest) {
  const { prompt, schema, asset, json, opts } = request;
  const model = modelFor('anthropic', opts);
  const haiku = model.startsWith('claude-haiku-');
  const policy = CLAUDE_FEATURES[opts.feature ?? ''];
  const content: any[] = [{ type: 'text', text: prompt }];
  if (asset) {
    const type = asset.mimeType === 'application/pdf' ? 'document' : 'image';
    if (type === 'image' && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(asset.mimeType)) {
      throw new Error('Claude does not support this document input');
    }
    content.push({ type, source: { type: 'base64', media_type: asset.mimeType, data: asset.data } });
  }
  return {
    model,
    max_tokens: opts.maxOutputTokens ?? policy?.maxOutputTokens ?? 8192,
    ...(!haiku ? { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] } : {}),
    ...(opts.systemInstruction?.trim() ? { system: opts.systemInstruction } : {}),
    messages: [{ role: 'user' as const, content }],
    ...(haiku && opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    // Haiku does not support effort. Its thinking stays at the existing model default.
    output_config: {
      ...(!haiku ? { effort: policy?.effort ?? (opts.effort === 'minimal' ? 'low' : opts.effort ?? 'low') } : {}),
      ...(json && schema ? { format: { type: 'json_schema', schema: toAnthropicSchema(schema) } } : {}),
    },
  };
}

function client(request: AiRequest) {
  const apiKey = keyFor('anthropic', request.opts);
  if (!apiKey) throw new Error('Anthropic credential is not configured');
  return new Anthropic({ apiKey, maxRetries: 0 });
}

function result(response: any, model: string): AiResult {
  return {
    text: response.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join(''),
    response, model: response.model ?? model, truncated: response.stop_reason === 'max_tokens', refused: response.stop_reason === 'refusal',
  };
}

export const anthropicAdapter: AiAdapter = {
  async generate(request) {
    const params = anthropicParameters(request);
    const response = await client(request).beta.messages.create(params as Anthropic.Beta.MessageCreateParamsNonStreaming);
    return result(response, params.model);
  },
  async stream(request) {
    const params = anthropicParameters(request);
    const stream = client(request).beta.messages.stream(params as Anthropic.Beta.MessageCreateParamsNonStreaming);
    return {
      chunks: (async function* () {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
        }
      })(),
      final: async () => result(await stream.finalMessage(), params.model),
    };
  },
};
