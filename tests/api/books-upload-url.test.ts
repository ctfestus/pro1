import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { POST } from '@/app/api/books/upload-url/route';
import { isBookObjectPath } from '@/lib/books/schema';

const mockRequireRole = vi.mocked(requireRole);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';

let createSignedUploadUrl: ReturnType<typeof vi.fn>;

function authAs(userId: string, role: string, book: any = { id: BOOK_ID, user_id: 'owner-1' }) {
  createSignedUploadUrl = vi.fn(async () => ({ data: { token: 'tok' }, error: null }));
  const serviceDb = {
    ...makeSupabaseStub({ books: { data: book } }),
    storage: { from: () => ({ createSignedUploadUrl }) },
  };
  mockRequireRole.mockResolvedValue({ user: { id: userId }, role, serviceDb } as any);
}

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/books/upload-url', {
    method: 'POST',
    body: JSON.stringify(body),
  }));

const VALID = { bookId: BOOK_ID, kind: 'file', format: 'epub', size: 5 * 1024 * 1024 };

describe('POST /api/books/upload-url', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('is closed to anyone requireRole rejects', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as any);
    expect((await call(VALID)).status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'instructor']);
  });

  it("refuses an instructor uploading into another author's book", async () => {
    authAs('instructor-2', 'instructor');
    expect((await call(VALID)).status).toBe(403);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown book', async () => {
    authAs('owner-1', 'instructor', null);
    expect((await call(VALID)).status).toBe(404);
  });

  it('rejects an unknown format or kind', async () => {
    authAs('owner-1', 'instructor');
    expect((await call({ ...VALID, format: 'exe' })).status).toBe(400);
    expect((await call({ ...VALID, kind: 'cover' })).status).toBe(400);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('enforces the 10 MB cap for HTML and 100 MB for other formats', async () => {
    authAs('owner-1', 'instructor');
    expect((await call({ ...VALID, format: 'html', size: 10 * 1024 * 1024 + 1 })).status).toBe(413);
    expect((await call({ ...VALID, size: 100 * 1024 * 1024 + 1 })).status).toBe(413);
    expect((await call({ ...VALID, size: 0 })).status).toBe(413);
  });

  it("issues a fresh object path inside the book's own folder for the owner", async () => {
    authAs('owner-1', 'instructor');
    const res = await call(VALID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ bucket: 'book-files', uploadToken: 'tok', contentType: 'application/epub+zip' });
    expect(isBookObjectPath(BOOK_ID, json.path, 'file', 'epub')).toBe(true);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(json.path);
  });

  it('builds the folder from the stored lowercase id, even when the request id is uppercase', async () => {
    // Hex letters, so upper-casing actually changes the id (an all-digit UUID would not).
    const HEX_ID = 'abcdef12-3456-4abc-8def-abcdef123456';
    const requested = HEX_ID.toUpperCase();
    expect(requested).not.toBe(HEX_ID);
    // Postgres matches the uppercase id and returns the stored, lowercase one.
    authAs('owner-1', 'instructor', { id: HEX_ID, user_id: 'owner-1' });
    const res = await call({ ...VALID, bookId: requested });
    expect(res.status).toBe(200);
    const { path } = await res.json();
    expect(path.startsWith(`${HEX_ID}/file-`)).toBe(true);
    expect(isBookObjectPath(HEX_ID, path, 'file', 'epub')).toBe(true);
  });

  it("lets an admin upload into any author's book", async () => {
    authAs('admin-1', 'admin');
    const res = await call({ ...VALID, kind: 'preview', format: 'pdf' });
    expect(res.status).toBe(200);
    expect(isBookObjectPath(BOOK_ID, (await res.json()).path, 'preview', 'pdf')).toBe(true);
  });
});
