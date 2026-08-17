import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

// All model names come from env -- no hardcoding
// The 2.x line is closed to new API keys: it returns 404 NOT_FOUND rather than degrading, so a
// deployment that relied on an older default would fail outright on every AI call.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

// Applied as a system instruction on every call so no individual prompt can miss it.
// Prevents the model outputting typographic "AI slop" regardless of prompt content.
const FORMATTING_SYSTEM_INSTRUCTION =
  'Plain ASCII only. Never use: em dashes (--), en dashes (-), ' +
  'curly/smart quotes, ellipsis characters, ' +
  'or any other non-ASCII typographic character. ' +
  'Use straight double quotes (") and straight apostrophes (\') only. ' +
  'Use a plain hyphen (-) where a dash is needed. ' +
  'Do not open any sentence with filler phrases such as "Certainly!", "Absolutely!", "Of course!", or "Great!". ' +
  'Write plainly and directly.';

// `key` lets a caller run on its OWN Gemini project instead of the platform key -- used by
// the student-facing lesson tutor so its free-tier quota is billed and exhausted separately
// from the authoring generators. Falls back to the platform key when unset.
function geminiClient(key?: string) {
  const apiKey = key || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  return new GoogleGenAI({ apiKey });
}

function openaiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

const safeJSON = (text: string) =>
  JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

export type GenerateJSONOpts = {
  temperature?: number;
  geminiRetries?: number;
  // Caps model thinking on large structured calls. Requires a Gemini 3+ model;
  // older models reject thinkingLevel. Unbounded thinking adds 10-100s of latency
  // per call and can starve the output budget, truncating the JSON mid-string.
  thinkingLevel?: 'minimal' | 'low';
  // Run this call on a different Gemini project / model than the platform default.
  // Both fall back to the platform values when unset.
  geminiApiKey?: string;
  geminiModel?: string;
  // Skip the OpenAI fallback. Routes on a dedicated free-tier key set this so a
  // quota exhaustion surfaces as an error instead of silently spending paid credit.
  noFallback?: boolean;
  // Hard ceiling on generated tokens. Without one, a runaway generation is billed in full --
  // and on a metered free tier that is the difference between one costly answer and a dead
  // feature for the rest of the day.
  maxOutputTokens?: number;
  // Replace the default anti-slop system instruction for this call only.
  //
  // The default forbids every non-ASCII character and tells the model to write plainly,
  // which is right for authored course content but suppresses markdown structure and
  // emoji on a chat surface -- and a system instruction outranks the prompt, so a route
  // cannot ask for structure without replacing this. Only override where the output is
  // rendered as rich text and is never persisted as course content.
  systemInstruction?: string;
};

function isRetryableGeminiError(err: unknown) {
  // Malformed JSON (bad string escaping, output cut off) is intermittent model
  // flakiness -- a retry of the same prompt almost always returns a clean response.
  if (err instanceof SyntaxError) return true;
  const error = err as { message?: string; cause?: { code?: string; errno?: number; message?: string } };
  const message = String(error?.message ?? '').toLowerCase();
  const causeMessage = String(error?.cause?.message ?? '').toLowerCase();
  const code = String(error?.cause?.code ?? '');
  return (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('truncated') ||
    causeMessage.includes('econnreset') ||
    code === 'ECONNRESET'
  );
}

async function generateGeminiJSON(
  prompt: string,
  geminiSchema?: any,
  opts: GenerateJSONOpts = {},
) {
  const retries = Math.max(0, opts.geminiRetries ?? 1);
  const config: any = {
    responseMimeType: 'application/json',
    systemInstruction: opts.systemInstruction || FORMATTING_SYSTEM_INSTRUCTION,
  };
  if (geminiSchema) config.responseSchema = geminiSchema;
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.thinkingLevel) config.thinkingConfig = { thinkingLevel: opts.thinkingLevel.toUpperCase() };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await geminiClient(opts.geminiApiKey).models.generateContent({
        model: opts.geminiModel || GEMINI_MODEL,
        contents: prompt,
        config,
      });
      // result.text silently returns partial JSON when the output budget runs out.
      if (result.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini response truncated (MAX_TOKENS)');
      }
      return safeJSON(result.text ?? '{}');
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !isRetryableGeminiError(err)) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function generateGeminiText(prompt: string, opts: GenerateJSONOpts = {}) {
  const retries = Math.max(0, opts.geminiRetries ?? 1);
  const config: any = {
    systemInstruction: opts.systemInstruction || FORMATTING_SYSTEM_INSTRUCTION,
  };
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.thinkingLevel) config.thinkingConfig = { thinkingLevel: opts.thinkingLevel.toUpperCase() };
  if (opts.maxOutputTokens) config.maxOutputTokens = opts.maxOutputTokens;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await geminiClient(opts.geminiApiKey).models.generateContent({
        model: opts.geminiModel || GEMINI_MODEL,
        contents: prompt,
        config,
      });
      // Deliberately NOT treating a MAX_TOKENS finish as an error the way the JSON path must:
      // a cut-off sentence is still a usable answer, while cut-off JSON is unparseable. That
      // difference is most of the reason this path exists -- it removes a retry trigger.
      const text = (result.text ?? '').trim();
      if (!text) throw new Error('Gemini returned an empty response');
      return text;
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !isRetryableGeminiError(err)) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}

// ---- 1. Plain text (primary: Gemini, fallback: OpenAI) ----
//
// For calls whose answer IS prose -- the lesson tutor. Asking those for JSON actively hurts:
// the model has to escape every newline inside the string, one literal newline makes the whole
// reply unparseable, and both that and a truncated string are classified retryable, so a
// formatting slip silently doubles the request count against the AI quota.
//
// Kept as its own path rather than a flag on generateJSON so the JSON path every other route
// depends on is left exactly as it was.
export async function generateText(prompt: string, opts: GenerateJSONOpts = {}): Promise<string> {
  try {
    return await generateGeminiText(prompt, opts);
  } catch (err) {
    if (opts.noFallback) throw err;
    const client = openaiClient();
    if (!client) {
      console.warn('[AI] Gemini text failed and no OpenAI fallback is configured:', (err as Error).message);
      throw err;
    }
    console.warn('[AI] Gemini text failed, falling back to OpenAI:', (err as Error).message);
    const res = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: opts.systemInstruction || FORMATTING_SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
    });
    const text = (res.choices[0]?.message?.content ?? '').trim();
    if (!text) throw err;
    return text;
  }
}

// ---- 2. Text JSON (primary: Gemini, fallback: OpenAI) ----
export async function generateJSON(
  prompt: string,
  geminiSchema?: any,
  opts: GenerateJSONOpts = {},
): Promise<any> {
  try {
    return await generateGeminiJSON(prompt, geminiSchema, opts);
  } catch (err) {
    if (opts.noFallback) throw err;
    const client = openaiClient();
    if (!client) {
      console.warn('[AI] Gemini failed and no OpenAI fallback is configured:', (err as Error).message);
      throw err;
    }
    console.warn('[AI] Gemini failed, falling back to OpenAI:', (err as Error).message);
    const res = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.systemInstruction || FORMATTING_SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    });
    return safeJSON(res.choices[0]?.message?.content ?? '{}');
  }
}

// ---- 3. Vision + Text JSON (primary: Gemini, fallback: OpenAI) ----
export async function generateVisionJSON(
  prompt: string,
  image: { data: string; mimeType: string },
  geminiSchema?: any,
  opts: { temperature?: number } = {},
): Promise<any> {
  try {
    const config: any = {
      responseMimeType: 'application/json',
      systemInstruction: FORMATTING_SYSTEM_INSTRUCTION,
    };
    if (geminiSchema) config.responseSchema = geminiSchema;
    if (opts.temperature !== undefined) config.temperature = opts.temperature;

    const result = await geminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }],
      config,
    });
    return safeJSON(result.text ?? '{}');
  } catch (err) {
    console.warn('[AI] Gemini vision failed, falling back to OpenAI:', (err as Error).message);
    const client = openaiClient();
    if (!client) throw err;
    if (!image.mimeType.startsWith('image/')) {
      throw new Error(`OpenAI vision fallback does not support ${image.mimeType}. Binary document types require Gemini.`);
    }
    const res = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: FORMATTING_SYSTEM_INSTRUCTION },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
          ],
        },
      ],
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    });
    return safeJSON(res.choices[0]?.message?.content ?? '{}');
  }
}

// ---- 4. Text Streaming JSON (primary: Gemini, fallback: OpenAI) ----
export async function generateStream(
  prompt: string,
  geminiSchema?: any,
): Promise<ReadableStream> {
  const encoder = new TextEncoder();

  try {
    const config: any = {
      responseMimeType: 'application/json',
      systemInstruction: FORMATTING_SYSTEM_INSTRUCTION,
    };
    if (geminiSchema) config.responseSchema = geminiSchema;

    const geminiStream = await geminiClient().models.generateContentStream({
      model: GEMINI_MODEL,
      contents: prompt,
      config,
    });

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of geminiStream) {
            const text = chunk.text;
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Generation failed. Please try again.' })));
        } finally {
          controller.close();
        }
      },
    });
  } catch (err) {
    console.warn('[AI] Gemini stream failed, falling back to OpenAI:', (err as Error).message);
    const client = openaiClient();
    if (!client) {
      const message = (err as Error).message;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: message })));
          controller.close();
        },
      });
    }
    const stream = await client.chat.completions.create({
      model: OPENAI_MODEL,
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: FORMATTING_SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
    });
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? '';
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch {
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'Generation failed. Please try again.' })));
        } finally {
          controller.close();
        }
      },
    });
  }
}
