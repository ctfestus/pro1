import Ajv, { type ValidateFunction } from 'ajv';
import type { JsonSchema } from './types';

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new WeakMap<JsonSchema, ValidateFunction>();

export class AiValidationError extends Error {
  constructor() { super('AI response does not match the response schema'); }
}

export function validateAiResult(schema: JsonSchema | undefined, result: unknown) {
  if (!schema) return;
  let validate = validators.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    // Routes often create a fresh schema per request. Do not retain those objects in
    // Ajv's strong cache; our weak cache still reuses validators for shared schemas.
    ajv.removeSchema(schema);
    validators.set(schema, validate);
  }
  // Never include response values or Ajv diagnostic data in operational logs.
  if (!validate(result)) throw new AiValidationError();
}

const CLAUDE_UNSUPPORTED = new Set([
  'minItems', 'maxItems', 'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern',
  'minProperties', 'maxProperties', 'propertyNames', 'patternProperties',
]);

/** Visit schema positions only: a property named "type" is data, not a schema keyword. */
export function mapSchema(schema: JsonSchema, transform: (node: JsonSchema) => JsonSchema): JsonSchema {
  const out = { ...schema };
  for (const key of ['properties', '$defs', 'definitions']) {
    if (out[key]) out[key] = Object.fromEntries(Object.entries(out[key]).map(([name, child]) =>
      [name, mapSchema(child as JsonSchema, transform)]));
  }
  for (const key of ['items', 'additionalProperties', 'not']) {
    if (out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) out[key] = mapSchema(out[key], transform);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (out[key]) out[key] = out[key].map((child: JsonSchema) => mapSchema(child, transform));
  }
  return transform(out);
}

export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  return mapSchema(schema, node => {
    const out = { ...node };
    // Gemini's responseSchema uses uppercase types and string-valued array bounds.
    if (typeof out.type === 'string') out.type = out.type.toUpperCase();
    for (const key of ['minItems', 'maxItems']) if (out[key] !== undefined) out[key] = String(out[key]);
    delete out.additionalProperties;
    delete out.$schema;
    return out;
  });
}

export function toAnthropicSchema(schema: JsonSchema): JsonSchema {
  return mapSchema(schema, node => {
    const out = { ...node };
    const hints: string[] = [];
    for (const key of CLAUDE_UNSUPPORTED) {
      if (out[key] !== undefined) {
        hints.push(`${key}: ${JSON.stringify(out[key])}`);
        delete out[key];
      }
    }
    if (hints.length) out.description = [out.description, `Requirements: ${hints.join('; ')}`].filter(Boolean).join('. ');
    if (out.type === 'object' || out.properties) out.additionalProperties = false;
    delete out.$schema;
    return out;
  });
}
