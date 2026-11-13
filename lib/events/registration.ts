import type { PublicEventField } from '@/lib/events/public-event';

/**
 * Checks a public registrant's answers against the event's own questions (publicEventFields).
 * Only known fields are kept, every value is a trimmed string with a length cap, a select answer
 * must be one of its options, and required questions must be answered. Pure, for tests.
 */
export function validateRegistrationResponses(
  fields: PublicEventField[],
  raw: unknown,
): { ok: true; responses: Record<string, string> } | { ok: false; error: string } {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const responses: Record<string, string> = {};
  for (const f of fields) {
    const v = input[f.name];
    const value = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    if (!value) {
      if (f.required) return { ok: false, error: `Answer "${f.label}".` };
      continue;
    }
    const max = f.type === 'textarea' ? 2000 : 300;
    if (value.length > max) return { ok: false, error: `"${f.label}" is too long.` };
    if (f.type === 'select' && !f.options.includes(value)) return { ok: false, error: `Choose an option for "${f.label}".` };
    if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, error: `"${f.label}" must be a number.` };
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: `"${f.label}" must be an email address.` };
    if (f.type === 'phone' && !/^[+()\d\s.-]{5,30}$/.test(value)) return { ok: false, error: `"${f.label}" must be a phone number.` };
    responses[f.name] = value;
  }
  return { ok: true, responses };
}
