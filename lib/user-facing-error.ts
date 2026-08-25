/**
 * Turns a thrown value into a sentence a learner can act on.
 *
 * Rendering `err.message` straight into the UI is how a student on a dropped connection came to
 * read "Failed to fetch (<project>.supabase.co)" on the sign-in screen: the browser's own
 * diagnostic, naming a host they cannot do anything about.
 *
 * Pass-through is the default on purpose. Supabase's auth strings ("Invalid login credentials",
 * "Email not confirmed") are written for people and must keep reaching them, as must the errors
 * this codebase throws deliberately to explain something. Only text that is recognisably for a
 * machine gets replaced.
 */

/** Shown when the request never reached the server. */
export const NETWORK_ERROR_MESSAGE = 'We could not reach the server. Check your connection and try again.';

/** Shown when the failure is real but the wording is not fit for a learner to read. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

// Every engine words a failed fetch differently, and the same engine changes its mind between
// versions. All of them mean one thing to a learner: the request did not get there.
const NETWORK_PHRASES = [
  'failed to fetch',          // Chromium
  'load failed',              // WebKit
  'networkerror',             // Firefox
  'fetch failed',             // undici, server side
  'network request failed',
  'err_internet_disconnected',
  'err_network_changed',
  'err_connection',
];

// A URL, a hostname or a JS error name means we are looking at machine text, whatever it says.
// This is the backstop that matters: the phrase list above cannot anticipate the next wording a
// browser invents, but infrastructure names must stay off the screen regardless.
const TECHNICAL_MARKERS = /https?:\/\/|\b[a-z0-9-]+\.(?:supabase\.co|vercel\.app|cloudinary\.com)\b|\b(?:TypeError|SyntaxError|ReferenceError|AbortError)\b|\bERR_[A-Z_]+\b/;

export function toUserFacingError(err: unknown): string {
  const raw = typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return GENERIC_ERROR_MESSAGE;

  const lower = text.toLowerCase();
  if (NETWORK_PHRASES.some(phrase => lower.includes(phrase))) return NETWORK_ERROR_MESSAGE;
  if (TECHNICAL_MARKERS.test(text)) return GENERIC_ERROR_MESSAGE;

  return text;
}
