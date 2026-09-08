export type AiUsageContext = {
  operation: string;
  attempt?: number;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

type Provider = 'gemini' | 'openai';

type ModelPrice = {
  input: number;
  cachedInput: number;
  output: number;
  asOf: string;
};

// USD per one million tokens. Keep the date in every emitted event so historical estimates
// remain interpretable when provider prices change. Unknown or overridden model names still log
// complete token usage, but estimatedCostUsd is null until a price is added here.
const MODEL_PRICES: Record<string, ModelPrice> = {
  'gemini-3.5-flash': { input: 1.5, cachedInput: 0.15, output: 9, asOf: '2026-09-08' },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6, asOf: '2026-09-08' },
};

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function compactMetadata(metadata: AiUsageContext['metadata']) {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function modalityBreakdown(details: unknown) {
  if (!Array.isArray(details)) return undefined;
  const normalized = details.map((item: any) => ({
    modality: String(item?.modality ?? item?.type ?? 'UNKNOWN'),
    tokens: firstNumber(item, ['tokenCount', 'token_count']),
  })).filter(item => item.tokens !== null);
  return normalized.length ? normalized : undefined;
}

export function buildAiUsageEvent(args: {
  provider: Provider;
  model: string;
  response: any;
  context: AiUsageContext;
}) {
  const { provider, model, response, context } = args;
  const usage = provider === 'gemini'
    ? (response?.usageMetadata ?? response?.usage_metadata ?? {})
    : (response?.usage ?? {});

  const inputTokens = provider === 'gemini'
    ? firstNumber(usage, ['promptTokenCount', 'prompt_token_count'])
    : firstNumber(usage, ['prompt_tokens', 'input_tokens']);
  const outputTokens = provider === 'gemini'
    ? firstNumber(usage, ['candidatesTokenCount', 'candidates_token_count'])
    : firstNumber(usage, ['completion_tokens', 'output_tokens']);
  const thinkingTokens = provider === 'gemini'
    ? firstNumber(usage, ['thoughtsTokenCount', 'thoughts_token_count'])
    : firstNumber(usage?.completion_tokens_details, ['reasoning_tokens']);
  const cachedTokens = provider === 'gemini'
    ? firstNumber(usage, ['cachedContentTokenCount', 'cached_content_token_count'])
    : firstNumber(usage?.prompt_tokens_details, ['cached_tokens']);
  const totalTokens = provider === 'gemini'
    ? firstNumber(usage, ['totalTokenCount', 'total_token_count'])
    : firstNumber(usage, ['total_tokens']);
  const finishReason = provider === 'gemini'
    ? response?.candidates?.[0]?.finishReason ?? response?.candidates?.[0]?.finish_reason ?? null
    : response?.choices?.[0]?.finish_reason ?? null;

  const price = MODEL_PRICES[model];
  let estimatedCostUsd: number | null = null;
  if (price && inputTokens !== null && outputTokens !== null) {
    const cached = Math.min(cachedTokens ?? 0, inputTokens);
    const uncached = Math.max(0, inputTokens - cached);
    // OpenAI completion_tokens already includes reasoning tokens. Gemini reports model thoughts
    // separately from candidate output, and both are billed at the output rate.
    const billableOutput = outputTokens + (provider === 'gemini' ? (thinkingTokens ?? 0) : 0);
    estimatedCostUsd = Number((
      (uncached * price.input + cached * price.cachedInput + billableOutput * price.output) / 1_000_000
    ).toFixed(8));
  }

  return {
    event: 'ai_usage',
    operation: context.operation,
    provider,
    model,
    attempt: context.attempt ?? 1,
    finishReason,
    inputTokens,
    outputTokens,
    thinkingTokens,
    cachedTokens,
    totalTokens,
    inputModalities: provider === 'gemini'
      ? modalityBreakdown(usage?.promptTokensDetails ?? usage?.prompt_tokens_details)
      : undefined,
    estimatedCostUsd,
    pricingBasis: price ? 'standard_paid_list' : null,
    pricingAsOf: price?.asOf ?? null,
    metadata: compactMetadata(context.metadata),
  };
}

export function logAiUsage(args: {
  provider: Provider;
  model: string;
  response: any;
  context?: AiUsageContext;
}) {
  try {
    if (!args.context) return;
    console.info('[ai-usage]', JSON.stringify(buildAiUsageEvent(args as Required<typeof args>)));
  } catch {
    // Telemetry must never affect an AI review, retry a model call, or trigger a fallback.
  }
}
