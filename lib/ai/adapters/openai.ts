import OpenAI from 'openai';
import { keyFor, modelFor } from '../config';
import type { AiAdapter, AiRequest, AiResult } from '../types';

export function openaiParameters(request: AiRequest) {
  const { prompt, schema, asset, json, opts } = request;
  if (asset && !asset.mimeType.startsWith('image/')) throw new Error('OpenAI does not support this document input');
  return {
    model: modelFor('openai', opts),
    ...(json ? { response_format: { type: 'json_object' as const } } : {}),
    messages: [
      { role: 'system' as const, content: opts.systemInstruction ?? '' },
      {
        role: 'user' as const,
        content: asset ? [
          { type: 'text' as const, text: prompt },
          { type: 'image_url' as const, image_url: { url: `data:${asset.mimeType};base64,${asset.data}` } },
        ] : prompt,
      },
      // JSON mode does not constrain a schema. Supply the contract, then validate locally.
      ...(schema ? [{ role: 'system' as const, content: `Return JSON matching this schema: ${JSON.stringify(schema)}` }] : []),
    ],
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
  };
}

function client(request: AiRequest) {
  const apiKey = keyFor('openai', request.opts);
  if (!apiKey) throw new Error('OpenAI credential is not configured');
  return new OpenAI({ apiKey, maxRetries: 0 });
}

function result(response: any, model: string, text = response.choices?.[0]?.message?.content ?? ''): AiResult {
  return { text, response, model, truncated: response.choices?.[0]?.finish_reason === 'length', refused: !!response.choices?.[0]?.message?.refusal };
}

export const openaiAdapter: AiAdapter = {
  async generate(request) {
    const params = openaiParameters(request);
    const response = await client(request).chat.completions.create(params);
    return result(response, params.model);
  },
  async stream(request) {
    const params = openaiParameters(request);
    const stream = await client(request).chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } });
    let response: any = {};
    let text = '';
    return {
      chunks: (async function* () {
        for await (const chunk of stream) {
          if (chunk.usage) response.usage = chunk.usage;
          if (chunk.choices.length) response.choices = chunk.choices;
          const choice = chunk.choices[0];
          if (choice?.delta?.refusal) response.refused = true;
          if (choice?.delta?.content) { text += choice.delta.content; yield choice.delta.content; }
        }
      })(),
      final: async () => ({ ...result(response, params.model, text), refused: response.refused }),
    };
  },
};
