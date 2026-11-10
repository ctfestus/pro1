import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireRole: vi.fn(), isAuthError: (v: any) => !!v?.error }));
const lib = vi.hoisted(() => ({ store: vi.fn(), audience: vi.fn(), create: vi.fn(), run: vi.fn(), build: vi.fn(), after: [] as (() => unknown)[] }));
vi.mock('@/lib/books/store', () => ({ loadStoreBook: lib.store }));
vi.mock('@/lib/books/announce', async (orig) => ({
  ...(await orig<typeof import('@/lib/books/announce')>()),
  announcementAudience: lib.audience,
  createAnnouncement: lib.create,
  buildAnnouncementEmail: lib.build,
  runAnnouncement: lib.run,
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { lib.after.push(fn); } }));
import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET, POST } from '@/app/api/books/announce/route';

const mockRole = vi.mocked(requireRole);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const BOOK = { id: BOOK_ID, user_id: 'author-1', slug: 'guide-1a2b', title: 'Guide', cover_image: null };
const LIVE = { id: BOOK_ID, slug: 'guide-1a2b', title: 'Guide', coverImage: null, free: false, prices: [{ currency: 'GHS', amount: 120 }] };
const as = (role: string, userId: string, tables: Record<string, any>) =>
  mockRole.mockResolvedValue({ user: { id: userId }, role, serviceDb: makeSupabaseStub(tables) } as any);
const send = (body: Record<string, unknown> = {}) =>
  POST(new NextRequest('http://localhost/api/books/announce', { method: 'POST', body: JSON.stringify({ bookId: BOOK_ID, subject: 'New: Guide', message: 'Out now', ...body }) }));

beforeEach(() => {
  vi.clearAllMocks();
  lib.after = [];
  lib.store.mockResolvedValue(LIVE);
  lib.audience.mockResolvedValue({ recipients: [{ id: 's1', email: 'a@x.test', name: 'A' }] });
  lib.create.mockResolvedValue({ id: 'a1' });
  lib.build.mockResolvedValue({ from: 'F', subject: 'New: Guide', html: '<p>H</p>' });
});

describe('POST /api/books/announce', () => {
  it('is for instructors and admins only', async () => {
    mockRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as any);
    expect((await send()).status).toBe(403);
  });

  it("never lets an instructor announce someone else's product", async () => {
    as('instructor', 'author-2', { books: { data: BOOK } });
    expect((await send()).status).toBe(404);
    expect(lib.after).toHaveLength(0);
  });

  it('refuses a product that is not live in the store', async () => {
    as('instructor', 'author-1', { books: { data: BOOK } });
    lib.store.mockResolvedValue(null);
    expect((await send()).status).toBe(409);
    expect(lib.after).toHaveLength(0);
  });

  it('refuses a second send within ten minutes', async () => {
    as('instructor', 'author-1', { books: { data: BOOK }, book_announcements: { data: [{ id: 'recent' }] } });
    expect((await send()).status).toBe(409);
    expect(lib.after).toHaveLength(0);
  });

  it('records the announcement with its audience, answers with the count, and sends afterwards', async () => {
    as('instructor', 'author-1', { books: { data: BOOK }, book_announcements: { data: [] } });
    const res = await send();
    expect(await res.json()).toEqual({ recipients: 1 });
    expect(lib.build).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'New: Guide', message: 'Out now', book: expect.objectContaining({ slug: 'guide-1a2b', priceLabel: expect.stringMatching(/GHS\s?120/) }),
    }));
    expect(lib.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookId: BOOK_ID, sentBy: 'author-1', subject: 'New: Guide', message: 'Out now', recipients: [{ id: 's1', email: 'a@x.test', name: 'A' }],
      email: { from: 'F', subject: 'New: Guide', html: '<p>H</p>' },
    }));
    expect(lib.run).not.toHaveBeenCalled();
    for (const fn of lib.after) await fn();
    expect(lib.run).toHaveBeenCalledWith(expect.anything(), 'a1', expect.any(Function));
  });

  it('refuses while a send for this product is still in progress', async () => {
    as('instructor', 'author-1', { books: { data: BOOK }, book_announcements: { data: [] } });
    lib.create.mockResolvedValue('busy');
    expect((await send()).status).toBe(409);
    expect(lib.after).toHaveLength(0);
  });

  it('needs a subject and a message, and strips line breaks from the subject', async () => {
    as('admin', 'boss', { books: { data: BOOK }, book_announcements: { data: [] } });
    expect((await send({ subject: '  ' })).status).toBe(400);
    expect((await send({ message: '' })).status).toBe(400);
    expect((await send({ subject: 'x'.repeat(201) })).status).toBe(400);
    await send({ subject: 'Line\r\nBcc: evil@x.test' });
    expect(lib.create.mock.calls[0][1].subject).toBe('Line Bcc: evil@x.test');
  });
});

describe('GET /api/books/announce', () => {
  it('shows the audience and past sends, for the owner', async () => {
    as('instructor', 'author-1', { books: { data: BOOK }, book_announcements: { data: [{ created_at: '2026-11-01', subject: 'S', recipients: 5, sent: 5, status: 'sent' }] } });
    const body = await (await GET(new NextRequest(`http://localhost/api/books/announce?bookId=${BOOK_ID}`))).json();
    expect(body).toMatchObject({ available: true, recipients: 1, history: [{ subject: 'S' }] });
  });
});
