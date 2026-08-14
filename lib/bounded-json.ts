// Read a request body as JSON while enforcing a hard byte ceiling.
//
// Streams the body and counts RAW bytes, aborting (and cancelling the stream) the instant the cap is
// exceeded, so an over-large body - including chunked requests that omit Content-Length - is never
// fully buffered or JSON-parsed. This is the platform-independent guarantee; a Content-Length check
// at the call site is only a cheaper early reject in front of it.
//
// Shared by the AI text-review routes (ve-answer-review, written-review) so the limit behaves
// identically wherever a student pastes free text.

import type { NextRequest } from 'next/server';

export type BoundedBody =
  | { status: 'ok'; body: any }
  | { status: 'too_large' }
  | { status: 'bad_json' };

/** Malformed or empty JSON resolves to 'bad_json' (callers map that to 400). */
export async function readBoundedJson(req: NextRequest, maxBytes: number): Promise<BoundedBody> {
  const reader = req.body?.getReader();
  if (!reader) return { status: 'bad_json' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength; // raw bytes, not decoded characters
      if (total > maxBytes) {
        await reader.cancel();
        return { status: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { status: 'bad_json' };
  }
  if (total === 0) return { status: 'bad_json' };
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  try {
    return { status: 'ok', body: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { status: 'bad_json' };
  }
}
