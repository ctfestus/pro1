import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => { throw new Error('tests pass a db'); } }));
vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

import { requireRole } from '@/lib/api-auth';
import { makeSupabaseStub } from '../helpers/supabaseStub';
import { GET } from '@/app/api/books/[id]/page-preview/route';
import { storeBlockers } from '@/lib/books/store';

const mockAuth = vi.mocked(requireRole);
const ID = '11111111-1111-4111-8111-111111111111';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = (extra: Record<string, unknown> = {}) => ({
  id: ID, user_id: 'owner-1', slug: 'field-guide', title: 'Field Guide', subtitle: 'Sub', description: '<p>About</p>',
  cover_image: 'covers/x', authors: ['A. Writer'], category: 'Data', topics: ['SQL'], skills: [], difficulty: null,
  estimated_minutes: null, format: 'pdf', file_size: 2048, purchasable: true, available_to_everyone: false,
  license_expires_at: null, updated_at: '2026-11-01', status: 'draft', product_type: 'guide', product_type_label: null,
  file_path: `${ID}/file-${U}.pdf`, preview_file_path: `${ID}/preview-${U}.pdf`,
  ...extra,
});

function authAs(userId: string, role: string, book: any) {
  mockAuth.mockResolvedValue({
    user: { id: userId }, role,
    serviceDb: makeSupabaseStub({
      books: { data: book },
      book_prices: { data: [{ book_id: ID, currency: 'GHS', amount: 120, sale_amount: null, sale_ends_at: null }], count: 1 },
      students: { data: { full_name: 'Ama Owner', avatar_url: null, bio: null, social_links: {} } },
    }),
  } as any);
}
const call = (id = ID) => GET(new NextRequest(`http://localhost/api/books/${id}/page-preview`), { params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/[id]/page-preview', () => {
  it('is only for instructors and admins', async () => {
    mockAuth.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as any);
    expect((await call()).status).toBe(403);
    expect(mockAuth.mock.calls[0][1]).toEqual(['admin', 'instructor']);
  });

  it('shows a draft to its owner, with what keeps it off the store, and never a file path', async () => {
    authAs('owner-1', 'instructor', row());
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toContain('file_path');
    expect(text).not.toContain(`file-${U}`);
    expect(text).not.toContain(`preview-${U}`);
    const json = JSON.parse(text);
    expect(json.book).toMatchObject({ id: ID, title: 'Field Guide', productTypeLabel: 'Guide', free: false, hasSample: true });
    expect(json.book.prices).toEqual([{ currency: 'GHS', amount: 120 }]);
    expect(json.book.instructor?.name).toBe('Ama Owner');
    expect(json.blockers).toEqual(['It is a draft. Publish it to put this page live.']);
  });

  it('refuses another instructor, and lets an admin in', async () => {
    authAs('someone-else', 'instructor', row());
    expect((await call()).status).toBe(403);
    authAs('admin-1', 'admin', row());
    expect((await call()).status).toBe(200);
  });

  it('is a 404 for an unknown or malformed id', async () => {
    authAs('owner-1', 'instructor', null);
    expect((await call()).status).toBe(404);
    expect((await call('nope')).status).toBe(404);
  });
});

describe('storeBlockers', () => {
  const GHS = [{ currency: 'GHS', amount: 120 }];
  it('is empty for a live product', () => {
    expect(storeBlockers(row({ status: 'published' }), GHS)).toEqual([]);
    expect(storeBlockers(row({ status: 'published', purchasable: false, available_to_everyone: true }), [])).toEqual([]);
  });
  it('names each reason', () => {
    expect(storeBlockers(row({ status: 'archived' }), GHS)).toEqual(['It is archived.']);
    expect(storeBlockers(row({ status: 'published', file_path: null }), GHS)).toEqual(['No product file is saved yet.']);
    expect(storeBlockers(row({ status: 'published', license_expires_at: '2000-01-01' }), GHS)).toEqual(['Its licence has expired.']);
    expect(storeBlockers(row({ status: 'published' }), [])).toEqual(['It is neither for sale with a price nor free to everyone.']);
  });
});
