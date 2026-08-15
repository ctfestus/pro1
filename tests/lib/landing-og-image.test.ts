import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isAllowedLandingOgImageUrl,
  loadLandingOgImageDataUrl,
} from '@/lib/landing-og-image';

const originalAllowedHosts = process.env.OG_IMAGE_ALLOWED_HOSTS;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAllowedHosts === undefined) delete process.env.OG_IMAGE_ALLOWED_HOSTS;
  else process.env.OG_IMAGE_ALLOWED_HOSTS = originalAllowedHosts;
});

describe('landing Open Graph image', () => {
  it('allows only HTTPS URLs on an exact configured hostname', () => {
    const hosts = new Set(['images.example.com']);

    expect(isAllowedLandingOgImageUrl('https://images.example.com/banner.jpg', hosts)).toBe(true);
    expect(isAllowedLandingOgImageUrl('http://images.example.com/banner.jpg', hosts)).toBe(false);
    expect(isAllowedLandingOgImageUrl('https://images.example.com.attacker.test/banner.jpg', hosts)).toBe(false);
    expect(isAllowedLandingOgImageUrl('https://127.0.0.1/banner.jpg', hosts)).toBe(false);
  });

  it('uses configured hosts when the image provider changes', async () => {
    process.env.OG_IMAGE_ALLOWED_HOSTS = 'cdn.example.com';
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(jpeg, {
      headers: { 'content-type': 'image/jpeg' },
    }));

    await expect(loadLandingOgImageDataUrl('https://cdn.example.com/banner.jpg'))
      .resolves.toMatch(/^data:image\/jpeg;base64,/);
  });

  it('rejects failed, non-image, oversized, and malformed image responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    }));
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) },
    }));
    fetchMock.mockResolvedValueOnce(new Response('not a png', {
      headers: { 'content-type': 'image/png' },
    }));

    const url = 'https://res.cloudinary.com/example/image/upload/banner.jpg';
    await expect(loadLandingOgImageDataUrl(url)).resolves.toBeNull();
    await expect(loadLandingOgImageDataUrl(url)).resolves.toBeNull();
    await expect(loadLandingOgImageDataUrl(url)).resolves.toBeNull();
    await expect(loadLandingOgImageDataUrl(url)).resolves.toBeNull();
  });
});
