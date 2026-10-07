import type { AiUsageContext } from '@/lib/ai-usage';

export type AiProvider = 'gemini' | 'openai' | 'anthropic';
export type JsonSchema = Record<string, any>;
export type GenerateJSONOpts = {
  feature?: string;
  tier?: 'fast' | 'standard';
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  retries?: number;
  maxOutputTokens?: number;
  apiKey?: string;
  temperature?: number;
  noFallback?: boolean;
  systemInstruction?: string;
  usageContext?: AiUsageContext;
};

export type AiRequest = {
  prompt: string;
  schema?: JsonSchema;
  asset?: { data: string; mimeType: string };
  json: boolean;
  opts: GenerateJSONOpts;
};
export type AiResult = { text: string; response: any; model: string; truncated?: boolean; refused?: boolean };
export type AiStream = { chunks: AsyncIterable<string>; final: () => Promise<AiResult> };
export type AiAdapter = {
  generate(request: AiRequest): Promise<AiResult>;
  stream(request: AiRequest): Promise<AiStream>;
};
