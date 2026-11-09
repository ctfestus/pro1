import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '@/app/api/html-embed/route';

const PROJECT_URL = 'https://testproj.supabase.co';
const HTML_URL = `${PROJECT_URL}/storage/v1/object/public/form-assets/lesson-html/user-1/page.html`;

function requestFor(url: string) {
  return new NextRequest(`http://localhost/api/html-embed?url=${encodeURIComponent(url)}`);
}

describe('GET /api/html-embed', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROJECT_URL;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects storage HTML outside the protected lesson-html folder', async () => {
    const response = await GET(requestFor(
      `${PROJECT_URL}/storage/v1/object/public/form-assets/student-content/page.html`,
    ));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves valid HTML with the isolated sandbox policy', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html><p>Safe embed</p>', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const response = await GET(requestFor(HTML_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('Safe embed');
    expect(fetchMock).toHaveBeenCalledWith(
      HTML_URL,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects an oversized Content-Length before reading the body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; },
    });
    fetchMock.mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
    }));

    const response = await GET(requestFor(HTML_URL));

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it('cancels a streamed response as soon as it crosses 10 MB', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
      },
      cancel() { cancelled = true; },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

    const response = await GET(requestFor(HTML_URL));

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it('returns a gateway error when the upstream object cannot be fetched', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    const response = await GET(requestFor(HTML_URL));

    expect(response.status).toBe(502);
  });
});
