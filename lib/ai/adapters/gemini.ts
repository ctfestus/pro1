import { GoogleGenAI } from '@google/genai';
import { keyFor, modelFor } from '../config';
import { toGeminiSchema } from '../schema';
import type { AiAdapter, AiRequest, AiResult } from '../types';

export function geminiParameters(request: AiRequest) {
  const { prompt, schema, asset, json, opts } = request;
  const model = modelFor('gemini', opts);
  const config: any = opts.systemInstruction?.trim() ? { systemInstruction: opts.systemInstruction } : {};
  if (json) config.responseMimeType = 'application/json';
  if (schema) config.responseSchema = toGeminiSchema(schema);
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.maxOutputTokens) config.maxOutputTokens = opts.maxOutputTokens;
  if (opts.effort && Number(/^gemini-(\d+)/.exec(model)?.[1]) >= 3) {
    config.thinkingConfig = { thinkingLevel: opts.effort.toUpperCase() };
  }
  return {
    model,
    contents: asset ? [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: asset.mimeType, data: asset.data } }] }] : prompt,
    config,
  };
}

function client(request: AiRequest) {
  const apiKey = keyFor('gemini', request.opts);
  if (!apiKey) throw new Error('Gemini credential is not configured');
  return new GoogleGenAI({ apiKey });
}

function result(response: any, model: string, text = response.text ?? ''): AiResult {
  return { text, model, response, truncated: response.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
}

export const geminiAdapter: AiAdapter = {
  async generate(request) {
    const params = geminiParameters(request);
    const response = await client(request).models.generateContent(params);
    return result(response, params.model);
  },
  async stream(request) {
    const params = geminiParameters(request);
    const stream = await client(request).models.generateContentStream(params);
    let response: any = {};
    let text = '';
    return {
      chunks: (async function* () {
        for await (const chunk of stream) {
          response = { ...response, ...chunk };
          if (chunk.text) { text += chunk.text; yield chunk.text; }
        }
      })(),
      final: async () => result(response, params.model, text),
    };
  },
};
