import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { generateJSON, isAiFeatureConfigured } from '@/lib/ai';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { isReadableFormat } from '@/lib/books/schema';
import { SUGGESTION_SCHEMA, normalizeSuggestions, outlineFromInput, suggestionPrompt } from '@/lib/books/chapter-suggestions';

// POST /api/books/suggest-chapters { bookId, format, outline: [{ text, level? }] } -> { chapters: [{ index, title }] }
//
// The editor's fallback when an uploaded book has no table of contents it can read. The browser
// sends an outline of the book (headings, documents or pages); the model picks which items start
// a chapter. See lib/books/chapter-suggestions.ts. Only the book's owner or an admin may ask, and
// only while the book's rights allow AI to read it.
export const dynamic = 'force-dynamic';

const FEATURE = 'books-suggest-chapters';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => null);
  const bookId = typeof body?.bookId === 'string' && UUID.test(body.bookId) ? body.bookId : null;
  // Chapters are only found in the formats the platform can read.
  const format = isReadableFormat(body?.format) ? body.format : null;
  if (!bookId || !format) return NextResponse.json({ error: 'A product and its format are required.' }, { status: 400 });
  const outline = outlineFromInput(body?.outline);
  if ('error' in outline) return NextResponse.json({ error: outline.error }, { status: 400 });

  const { data: book, error } = await auth.serviceDb
    .from('books')
    .select('id, user_id, title, ai_allowed')
    .eq('id', bookId)
    .maybeSingle();
  if (error) {
    console.error('[books/suggest-chapters] load failed', error.message);
    return NextResponse.json({ error: 'Could not load the product.' }, { status: 500 });
  }
  if (!book) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  if (auth.role !== 'admin' && book.user_id !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (book.ai_allowed === false) {
    return NextResponse.json({ error: 'This product\'s rights do not allow AI to read it. Add the chapters by hand.' }, { status: 403 });
  }

  if (!isAiFeatureConfigured(FEATURE)) return NextResponse.json({ error: 'AI is not set up on this platform.' }, { status: 503 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'AI suggestions are temporarily unavailable.' }, { status: 503 });
  try {
    if (await bumpRateLimit(redis, `rate:books-suggest-chapters:${auth.user.id}`, 20, 3600)) {
      return NextResponse.json({ error: 'AI chapter limit reached. Try again in an hour.' }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ error: 'AI suggestions are temporarily unavailable.' }, { status: 503 });
  }

  try {
    const result = await generateJSON(
      suggestionPrompt(format, String(book.title ?? ''), outline),
      SUGGESTION_SCHEMA,
      { feature: FEATURE, temperature: 0.2, maxOutputTokens: 8192, usageContext: { operation: 'book-chapter-suggestions', metadata: { format, items: outline.length } } },
    );
    const chapters = normalizeSuggestions(result, outline.length);
    if (!chapters.length) return NextResponse.json({ error: 'No chapters could be found in this product. Add them by hand.' }, { status: 422 });
    return NextResponse.json({ chapters });
  } catch (e) {
    console.warn('[books/suggest-chapters] failed:', (e as Error).message);
    return NextResponse.json({ error: 'Could not suggest chapters right now. Try again later.' }, { status: 502 });
  }
}
