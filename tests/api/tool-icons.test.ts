import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Tool icons are the first surface where an instructor's upload decides what renders on the
// PUBLIC landing page and public profile pages, so two things are pinned here: only staff may
// write, and the stored reference is validated rather than trusted -- it lands in an <img src>.

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  del: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/lib/admin-client', () => ({
  adminClient: () => ({
    from: () => ({
      select: () => ({ order: h.select }),
      upsert: h.upsert,
      delete: () => ({ eq: h.del }),
    }),
  }),
}));

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  return { ...actual, requireRole: vi.fn() };
});

import { requireRole } from '@/lib/api-auth';
import { GET, POST, DELETE } from '@/app/api/tool-icons/route';

const mockRole = vi.mocked(requireRole);
const staff = { user: { id: 'i1', email: 'i@x.co' }, serviceDb: {}, role: 'instructor', token: 't' };
const forbidden = { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

function send(handler: typeof POST, body: unknown) {
  return handler(new Request('http://localhost/api/tool-icons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any);
}

beforeEach(() => {
  mockRole.mockReset();
  h.upsert.mockReset().mockResolvedValue({ error: null });
  h.del.mockReset().mockResolvedValue({ error: null });
  h.select.mockReset().mockResolvedValue({ data: [{ name: 'looker studio', image: 'users/i1/tool-icons/x' }], error: null });
});

describe('GET /api/tool-icons', () => {
  it('is public and returns the stored icons', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).icons).toEqual([{ name: 'looker studio', image: 'users/i1/tool-icons/x' }]);
    // No auth check belongs on this read: the landing page renders these while signed out.
    expect(mockRole).not.toHaveBeenCalled();
  });

  it('reports an empty list when the read fails, so a logo cannot break the page it decorates', async () => {
    h.select.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).icons).toEqual([]);
  });
});

describe('POST /api/tool-icons', () => {
  it('refuses a caller who is not staff', async () => {
    mockRole.mockResolvedValue(forbidden as any);
    const res = await send(POST, { name: 'excel', image: 'users/s1/tool-icons/x' });
    expect(res.status).toBe(403);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('stores the name normalized so it matches the text typed on a course', async () => {
    mockRole.mockResolvedValue(staff as any);
    const res = await send(POST, { name: '  Power   BI ', image: 'users/i1/tool-icons/pbi' });
    expect(res.status).toBe(200);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'power bi', image: 'users/i1/tool-icons/pbi' }),
      { onConflict: 'name' },
    );
  });

  it('accepts an https URL, which is how an SVG logo is stored', async () => {
    mockRole.mockResolvedValue(staff as any);
    const res = await send(POST, { name: 'aws', image: 'https://res.cloudinary.com/c/image/upload/a.svg' });
    expect(res.status).toBe(200);
  });

  it.each([
    ['javascript:alert(1)', 'a script scheme'],
    ['data:image/svg+xml;base64,AAAA', 'a data URI'],
    ['http://insecure.example/a.png', 'plain http'],
    ['', 'an empty reference'],
  ])('rejects %s (%s)', async (image) => {
    mockRole.mockResolvedValue(staff as any);
    const res = await send(POST, { name: 'excel', image });
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('rejects a missing tool name', async () => {
    mockRole.mockResolvedValue(staff as any);
    const res = await send(POST, { name: '   ', image: 'users/i1/tool-icons/x' });
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/tool-icons', () => {
  it('refuses a caller who is not staff', async () => {
    mockRole.mockResolvedValue(forbidden as any);
    const res = await send(DELETE, { name: 'excel' });
    expect(res.status).toBe(403);
    expect(h.del).not.toHaveBeenCalled();
  });

  it('deletes by the normalized name', async () => {
    mockRole.mockResolvedValue(staff as any);
    const res = await send(DELETE, { name: 'Power BI' });
    expect(res.status).toBe(200);
    expect(h.del).toHaveBeenCalledWith('name', 'power bi');
  });
});
