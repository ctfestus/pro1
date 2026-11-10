// Preview and test sends for launch emails: the real email, only ever to the person asking.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireRole: vi.fn(), isAuthError: (v: any) => !!v?.error }));
const lib = vi.hoisted(() => ({ store: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/books/store', () => ({ loadStoreBook: lib.store }));
vi.mock('resend', () => ({ Resend: class { emails = { send: lib.send }; } }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({ appName: 'Tenant', appUrl: 'https://learn.example.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team', senderName: 'Tenant', supportEmail: 'help@learn.example.test' }),
}));
vi.mock('@/lib/email-template-service', () => ({
  applyEmailTemplate: async (i: any) => ({ subject: i.fallbackSubject, html: i.fallbackHtml, customized: false }),
}));

import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { POST as PREVIEW } from '@/app/api/books/announce/preview/route';
import { POST as TEST } from '@/app/api/books/announce/test/route';
import { parseAnnouncementInput } from '@/lib/books/announce-request';

const mockRole = vi.mocked(requireRole);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const BOOK = { id: BOOK_ID, user_id: 'author-1', slug: 'guide-1a2b', title: 'Guide' };
const LIVE = { id: BOOK_ID, slug: 'guide-1a2b', title: 'Guide', coverImage: null, free: false, prices: [{ currency: 'GHS', amount: 120 }] };
const as = (role: string, userId: string, name = '<b>Ama</b>', email: string | undefined = 'ama@x.test') =>
  mockRole.mockResolvedValue({ user: { id: userId, email }, role, serviceDb: makeSupabaseStub({ books: { data: BOOK }, students: { data: { full_name: name } } }) } as any);
const call = (handler: any, body: Record<string, unknown> = {}) =>
  handler(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ bookId: BOOK_ID, subject: 'New: Guide', message: '<p>Out <b>now</b></p>', ...body }) }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 're_test';
  lib.store.mockResolvedValue(LIVE);
  lib.send.mockResolvedValue({ error: null });
});

describe('announcement input', () => {
  it('refuses an empty rich text message (the editor still holds markup)', () => {
    expect(parseAnnouncementInput({ bookId: BOOK_ID, subject: 'S', message: '<p><br></p>' })).toEqual({ error: 'Add a message.' });
    expect(parseAnnouncementInput({ bookId: BOOK_ID, subject: 'S', message: '<p>Hi</p>' })).toMatchObject({ message: '<p>Hi</p>' });
    // A message that is only an image is still a message.
    expect(parseAnnouncementInput({ bookId: BOOK_ID, subject: 'S', message: '<p><img src="https://res.cloudinary.com/test-cloud/image/upload/a.jpg"></p>' })).not.toHaveProperty('error');
  });
});

describe('POST /api/books/announce/preview', () => {
  it('is for instructors and admins, and only for products they may announce', async () => {
    mockRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as any);
    expect((await call(PREVIEW)).status).toBe(403);
    as('instructor', 'author-2');
    expect((await call(PREVIEW)).status).toBe(404);
  });

  it('returns the real email addressed to the person previewing, name escaped, sends nothing', async () => {
    as('instructor', 'author-1');
    const body = await (await call(PREVIEW)).json();
    expect(body.subject).toBe('New: Guide');
    expect(body.html).toContain('Hi &lt;b&gt;Ama&lt;/b&gt;');
    expect(body.html).toContain('<p>Out <b>now</b></p>');
    expect(body.html).toContain('https://learn.example.test/products/guide-1a2b');
    expect(lib.send).not.toHaveBeenCalled();
  });
});

describe('POST /api/books/announce/test', () => {
  it('sends only to the account email of the person asking, whatever the request says', async () => {
    as('instructor', 'author-1');
    const res = await call(TEST, { to: 'everyone@x.test', email: 'victim@x.test' });
    expect(await res.json()).toEqual({ sentTo: 'ama@x.test' });
    expect(lib.send).toHaveBeenCalledTimes(1);
    expect(lib.send.mock.calls[0][0]).toMatchObject({ to: 'ama@x.test', subject: '[Test] New: Guide' });
  });

  it('refuses a product that is not live, and an account without an email', async () => {
    as('instructor', 'author-1');
    lib.store.mockResolvedValue(null);
    expect((await call(TEST)).status).toBe(409);
    lib.store.mockResolvedValue(LIVE);
    as('instructor', 'author-1', 'Ama', '');
    expect((await call(TEST)).status).toBe(400);
    expect(lib.send).not.toHaveBeenCalled();
  });
});
