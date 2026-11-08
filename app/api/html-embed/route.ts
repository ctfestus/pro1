import { NextRequest, NextResponse } from 'next/server';
import { isStorageHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { readBodyWithLimit } from '@/lib/read-body-with-limit';

// Matches the 10 MB cap the editor upload buttons enforce.
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/**
 * Re-serves instructor-uploaded .html files from the public form-assets bucket
 * as renderable pages. Supabase intentionally serves HTML as plain text on the
 * default *.supabase.co domain (anti-phishing), so storage URLs cannot render
 * in an iframe directly; this route fetches the file and returns it as
 * text/html under a CSP sandbox. The sandbox gives the document an opaque
 * origin -- scripts run, but the page cannot touch this app's cookies,
 * storage, or DOM (the same isolation as a cross-origin iframe). middleware.ts
 * skips the app CSP for this path so the sandbox policy below is the only one.
 *
 * Intentionally unauthenticated: it only re-serves files that are already
 * public, and iframe navigations cannot carry Bearer auth headers. The SSRF
 * surface is closed by isStorageHtmlEmbedUrl -- exact project host, public
 * form-assets path, and .html extension only.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || '';
  if (!isStorageHtmlEmbedUrl(url)) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 });
    }

    const contentLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
      await upstream.body?.cancel('HTML embed exceeds 10 MB');
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 });
    }
    const body = await readBodyWithLimit(upstream, MAX_BYTES);
    if (!body) {
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': 'sandbox allow-scripts allow-popups',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
