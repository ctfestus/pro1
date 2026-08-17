import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { cloudinary } from '@/lib/cloudinary-server';
import dns from 'dns/promises';
import net from 'net';

export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_URL_BYTES = 512 * 1024; // URL imports only need enough HTML/text to extract source material
const MAX_SOURCE_CHARS = 100_000;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';

// Document types Gemini can read directly as inlineData.
const SUPPORTED_MIME: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  txt:  'text/plain',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt:  'application/vnd.ms-powerpoint',
};


async function checkRateLimit(userId: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  try {
    if (await bumpRateLimit(redis, `rate:doc-course-extract:${userId}`, 20, 3600)) {
      return NextResponse.json({ error: 'Limit reached: 20 document ingests per hour.' }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
}

const EXTRACT_PROMPT = `You are extracting the teachable content from a document so it can be turned into a course.

Return clean, well-structured Markdown that faithfully captures the substantive content:
- Preserve all key facts, definitions, steps, procedures, examples, and important details.
- Keep the original heading structure where it exists; use Markdown headings (#, ##, ###).
- Convert tables to Markdown tables and lists to Markdown lists.
- Omit page headers/footers, navigation, cookie notices, legal boilerplate, and decorative filler.
- Do not summarize away detail and do not invent content that is not in the document.
- Plain ASCII only. No em dashes, no curly quotes, no ellipsis characters.

Output only the Markdown content, with no preamble or commentary.`;

function normalizeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIPv4(ip: string) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string) {
  const h = normalizeHost(ip);
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('ff')) return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

async function validatePublicFetchUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid URL.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'That URL is not allowed.' };
  if (parsed.username || parsed.password) return { ok: false, error: 'Credentials in URLs are not allowed.' };

  const hostname = normalizeHost(parsed.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
    return { ok: false, error: 'That URL is not allowed.' };
  }

  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { ok: false, error: 'That URL is not allowed.' };
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length || records.some(record => isPrivateIp(record.address))) {
      return { ok: false, error: 'That URL is not allowed.' };
    }
  } catch {
    return { ok: false, error: 'Could not verify that URL.' };
  }

  return { ok: true, url: parsed };
}

async function readResponseTextWithCap(res: Response, maxBytes: number): Promise<string> {
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error('Response too large');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Response too large');
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractFromFile(file: File, ext: string, mimeType: string): Promise<{ sourceText: string }> {
  const buffer = Buffer.from(await file.arrayBuffer());

  // Plain text needs no model round-trip.
  if (ext === 'txt') return { sourceText: buffer.toString('utf-8').slice(0, MAX_SOURCE_CHARS) };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });

  // Plain text (not JSON) so truncation on large docs degrades gracefully instead of breaking JSON.parse.
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: EXTRACT_PROMPT }, { inlineData: { mimeType, data: buffer.toString('base64') } }] }],
    config: { temperature: 0.1 },
  });

  return { sourceText: (result.text ?? '').slice(0, MAX_SOURCE_CHARS) };
}

async function uploadPdf(file: File, userId: string): Promise<{ pdfUrl: string; pageCount: number } | null> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const res = await new Promise<{ secure_url: string; pages?: number }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `users/${userId}/doc-course`, resource_type: 'auto', overwrite: true },
        (err, r) => (err || !r ? reject(err ?? new Error('Upload failed')) : resolve(r as any)),
      ).end(buffer);
    });
    return { pdfUrl: res.secure_url, pageCount: res.pages && res.pages > 0 ? res.pages : 1 };
  } catch (err) {
    console.warn('[doc-course] PDF upload failed (page images disabled):', (err as Error).message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const authRes = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(authRes)) return authRes.error;
  const auth = { userId: authRes.user.id };

  const rateLimitError = await checkRateLimit(auth.userId);
  if (rateLimitError) return rateLimitError;

  const contentType = req.headers.get('content-type') ?? '';

  try {
    // -- File upload (multipart) --
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File too large. Maximum size is 20 MB.' }, { status: 413 });
      }

      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const mimeType = SUPPORTED_MIME[ext];
      if (!mimeType) {
        return NextResponse.json({ error: 'Only PDF, DOCX, DOC, TXT, PPTX, and PPT files are supported.' }, { status: 400 });
      }

      const { sourceText } = await extractFromFile(file, ext, mimeType);
      if (!sourceText.trim()) {
        return NextResponse.json({ error: 'Could not read any content from this file.' }, { status: 422 });
      }

      // PDFs get a Cloudinary copy so lessons can reference page images.
      let pdfUrl: string | undefined;
      let pageCount: number | undefined;
      if (ext === 'pdf') {
        const uploaded = await uploadPdf(file, auth.userId);
        if (uploaded) { pdfUrl = uploaded.pdfUrl; pageCount = uploaded.pageCount; }
      }

      return NextResponse.json({ sourceText, pdfUrl, pageCount });
    }

    // -- Paste text or URL (JSON) --
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

    if (typeof body.text === 'string' && body.text.trim()) {
      return NextResponse.json({ sourceText: body.text.slice(0, MAX_SOURCE_CHARS) });
    }

    if (typeof body.url === 'string' && body.url.trim()) {
      const urlCheck = await validatePublicFetchUrl(body.url.trim());
      if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 });
      const parsed = urlCheck.url;
      let res: Response;
      try {
        res = await fetch(parsed.toString(), {
          redirect: 'error',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CourseBuilder/1.0)' },
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return NextResponse.json({ error: 'Could not fetch that URL.' }, { status: 422 });
      }
      if (!res.ok) return NextResponse.json({ error: `Could not fetch that URL (status ${res.status}).` }, { status: 422 });
      let html: string;
      try {
        html = await readResponseTextWithCap(res, MAX_URL_BYTES);
      } catch {
        return NextResponse.json({ error: 'That URL returned too much content to ingest safely.' }, { status: 413 });
      }
      const sourceText = stripHtml(html).slice(0, MAX_SOURCE_CHARS);
      if (!sourceText.trim()) return NextResponse.json({ error: 'No readable content found at that URL.' }, { status: 422 });
      return NextResponse.json({ sourceText });
    }

    return NextResponse.json({ error: 'Provide a file, text, or url.' }, { status: 400 });
  } catch (err: any) {
    console.error('[doc-course] extract error:', err);
    return NextResponse.json({ error: 'Failed to read the document. Please try again.' }, { status: 500 });
  }
}
