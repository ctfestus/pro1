import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// More file formats and link products (migration 243).

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(),
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));
vi.mock('@/lib/books/guest-access', () => ({ verifyGuestAccessToken: vi.fn() }));
vi.mock('@/lib/books/guest-purchase', () => ({
  guestRateLimited: vi.fn(async () => false),
  loadGuestPurchase: vi.fn(),
  guestAccessState: vi.fn(() => 'ready'),
  guestBookAvailable: vi.fn(() => true),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));
vi.mock('@/lib/books/downloads', () => ({ logBookDownload: vi.fn(async () => {}) }));

import { requireRole, requireUser } from '@/lib/api-auth';
import { verifyGuestAccessToken } from '@/lib/books/guest-access';
import { loadGuestPurchase } from '@/lib/books/guest-purchase';
import { adminClient } from '@/lib/admin-client';
import { logBookDownload } from '@/lib/books/downloads';
import { makeSupabaseStub, type QueryResult } from '../helpers/supabaseStub';
import { PUT } from '@/app/api/books/route';
import { GET as getFile } from '@/app/api/books/[id]/file/route';
import { POST as guestOpen } from '@/app/api/books/guest-access/open/route';
import { POST as guestDownload } from '@/app/api/books/guest-access/download/route';
import { POST as uploadUrl } from '@/app/api/books/upload-url/route';
import {
  BOOK_MIME_BY_FORMAT, hasDeliverable, isBookObjectPath, isReadableFormat, normalizeProductLink, validateBookForPublish, normalizeBook,
} from '@/lib/books/schema';
import { formatLabel, getItLabel, opensInBrowser } from '@/lib/books/format';

const BOOK_ID = 'abcdef12-3456-4abc-8def-abcdef123456';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINK = 'https://www.canva.com/design/DAF123/view?mode=preview';

const PDF_BOOK = {
  id: BOOK_ID, user_id: 'author-1', slug: 'kit-a1b2', title: 'Kit', status: 'draft',
  cohort_ids: [], available_to_everyone: false, purchasable: false, royalty_pct: 0,
  format: 'pdf', file_path: `${BOOK_ID}/file-${U}.pdf`, file_size: 1000, preview_file_path: `${BOOK_ID}/preview-${U}.pdf`,
  license_type: 'own', license_expires_at: null, updated_at: '2026-11-08T10:00:00.000Z',
};
const LINK_BOOK = { ...PDF_BOOK, format: 'link', file_path: null, file_size: null, preview_file_path: null };

let rpc: Mock<(fn: string, args: Record<string, any>) => QueryResult>;
let storage: { info: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; createSignedUrl: ReturnType<typeof vi.fn>; createSignedUploadUrl: ReturnType<typeof vi.fn> };

function serviceDb(tables: Record<string, QueryResult | QueryResult[]>, row: any = null, contentType = 'application/pdf') {
  rpc = vi.fn((fn: string, args: Record<string, any>): QueryResult => (
    fn === 'save_book' ? { data: { ...row, ...args.p_patch }, error: null } : { data: { ok: true, remaining: 4 }, error: null }
  ));
  storage = {
    info: vi.fn(async () => ({ data: { size: 5000, contentType }, error: null })),
    remove: vi.fn(async () => ({ data: null, error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}` }, error: null })),
    createSignedUploadUrl: vi.fn(async () => ({ data: { token: 'tok' }, error: null })),
  };
  return { ...makeSupabaseStub(tables, (fn, args) => rpc(fn, args)), storage: { from: () => storage } };
}
const saveArgs = (): any => rpc.mock.calls.find((c: any[]) => c[0] === 'save_book')?.[1];
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/books', { method: 'PUT', body: JSON.stringify(body) }));
function editorAs(row: any, extra: Record<string, QueryResult | QueryResult[]> = {}, contentType?: string) {
  vi.mocked(requireRole).mockResolvedValue({ user: { id: 'author-1' }, role: 'instructor',
    serviceDb: serviceDb({ books: { data: row }, book_prices: { data: [] }, ...extra }, row, contentType) } as any);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('format helpers', () => {
  it('accepts every new file type in a scoped path, and never a path for a link', () => {
    for (const f of ['zip', 'xlsx', 'docx', 'pptx', 'csv', 'txt', 'md']) {
      expect(isBookObjectPath(BOOK_ID, `${BOOK_ID}/file-${U}.${f}`, 'file', f)).toBe(true);
      expect(BOOK_MIME_BY_FORMAT[f as keyof typeof BOOK_MIME_BY_FORMAT]).toBeTruthy();
      expect(isReadableFormat(f)).toBe(false);
    }
    expect(isBookObjectPath(BOOK_ID, `${BOOK_ID}/file-${U}.link`, 'file', 'link')).toBe(false);
    expect(isBookObjectPath(BOOK_ID, `${BOOK_ID}/file-${U}.exe`, 'file', 'exe')).toBe(false);
    expect(['epub', 'pdf', 'html'].every(isReadableFormat)).toBe(true);
  });

  it('takes only full https links', () => {
    expect(normalizeProductLink(`  ${LINK}  `)).toBe(LINK);
    for (const bad of ['http://canva.com/x', 'javascript:alert(1)', 'https://user:pw@canva.com/x', 'canva.com/x', 'https://localhost/x', 'https://a b.com', '', 'https://x.com/' + 'a'.repeat(2000)]) {
      expect(normalizeProductLink(bad)).toBeNull();
    }
  });

  it('counts a link product as deliverable, and asks for its link before publishing', () => {
    expect(hasDeliverable({ id: BOOK_ID, format: 'link', file_path: null })).toBe(true);
    expect(hasDeliverable({ id: BOOK_ID, format: 'xlsx', file_path: null })).toBe(false);
    const book = normalizeBook({ ...LINK_BOOK, status: 'published' });
    expect(validateBookForPublish(book, [], { hasLink: false })).toContain('Add the link buyers will get.');
    expect(validateBookForPublish(book, [], { hasLink: true })).not.toContain('Add the link buyers will get.');
  });

  it('labels formats and buttons', () => {
    expect(formatLabel('xlsx')).toBe('Excel workbook');
    expect(formatLabel('link')).toBe('Online link');
    expect(getItLabel('link')).toBe('Open');
    expect(getItLabel('zip')).toBe('Download');
    expect(opensInBrowser('pdf')).toBe(true);
    expect(opensInBrowser('docx')).toBe(false);
  });
});

describe('saving a product as a link or a new file type', () => {
  it('saves the link in the same transaction and removes the old file and sample', async () => {
    editorAs(PDF_BOOK);
    const res = await put({ id: BOOK_ID, link: { url: LINK } });
    expect(res.status).toBe(200);
    const args = saveArgs();
    expect(args.p_link).toEqual({ url: LINK });
    expect(args.p_patch).toMatchObject({ format: 'link', file_path: null, file_size: null, preview_file_path: null, sample_spec: null });
    expect(args.p_chapters).toEqual([]);
    expect(args.p_clear_chapters).toBe(true);
    // Never written to books itself.
    expect(JSON.stringify(args.p_patch)).not.toContain('canva');
  });

  it('refuses a link that is not a full https address', async () => {
    editorAs(PDF_BOOK);
    expect((await put({ id: BOOK_ID, link: { url: 'http://canva.com/x' } })).status).toBe(400);
    expect(saveArgs()).toBeUndefined();
  });

  it('will not publish a link product without its link', async () => {
    editorAs(LINK_BOOK, { book_links: { data: null } });
    const res = await put({ id: BOOK_ID, status: 'published' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Add the link buyers will get.');
  });

  it('publishes a link product whose link is already saved, without resending it', async () => {
    editorAs({ ...LINK_BOOK, available_to_everyone: true }, { book_links: { data: { book_id: BOOK_ID } } });
    expect((await put({ id: BOOK_ID, status: 'published' })).status).toBe(200);
    expect(saveArgs().p_link).toBeNull();
  });

  it('takes an Excel file and drops chapters and the cut sample spec', async () => {
    editorAs(PDF_BOOK, {}, BOOK_MIME_BY_FORMAT.xlsx);
    const path = `${BOOK_ID}/file-${U}.xlsx`;
    expect((await put({ id: BOOK_ID, file: { path, format: 'xlsx' } })).status).toBe(200);
    const args = saveArgs();
    expect(args.p_patch).toMatchObject({ format: 'xlsx', file_path: path, sample_spec: null });
    expect(args.p_clear_chapters).toBe(true);
    expect(args.p_link).toBeNull();
  });

  it('refuses a "link" sent as a file format', async () => {
    editorAs(PDF_BOOK);
    expect((await put({ id: BOOK_ID, file: { path: `${BOOK_ID}/file-${U}.link`, format: 'link' } })).status).toBe(400);
  });
});

describe('uploads', () => {
  it('signs uploads for the new file types with their own content type, never for a link', async () => {
    vi.mocked(requireRole).mockResolvedValue({ user: { id: 'author-1' }, role: 'instructor',
      serviceDb: serviceDb({ books: { data: { id: BOOK_ID, user_id: 'author-1' } } }) } as any);
    const ask = (format: string) => uploadUrl(new NextRequest('http://localhost/api/books/upload-url', {
      method: 'POST', body: JSON.stringify({ bookId: BOOK_ID, kind: 'file', format, size: 1000 }),
    }));
    const res = await ask('pptx');
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.contentType).toBe(BOOK_MIME_BY_FORMAT.pptx);
    expect(d.path).toMatch(/\.pptx$/);
    expect((await ask('link')).status).toBe(400);
  });
});

describe('getting a link product', () => {
  const access = { students: { data: { role: 'student', cohort_id: null } }, learning_paths: { data: null } };
  const fileCall = () => getFile(new NextRequest(`http://localhost/api/books/${BOOK_ID}/file`), { params: Promise.resolve({ id: BOOK_ID }) });

  it('hands the link to a buyer, and logs it', async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: 'buyer' }, serviceDb: serviceDb({
      books: { data: { ...LINK_BOOK, status: 'published', purchasable: true } }, ...access,
      book_entitlements: { data: { id: 'e1' } }, book_links: { data: { url: LINK } },
    }) } as any);
    const res = await fileCall();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: LINK, link: true, format: 'link' });
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(logBookDownload).toHaveBeenCalled();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('gives someone who has not bought it neither the link nor a sample', async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: { id: 'stranger' }, serviceDb: serviceDb({
      books: { data: { ...LINK_BOOK, status: 'published', purchasable: true } }, ...access,
      book_entitlements: { data: null }, book_links: { data: { url: LINK } },
    }) } as any);
    const res = await fileCall();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('canva');
  });

  it('opens the link for a guest buyer without using a download, and refuses Download', async () => {
    vi.mocked(verifyGuestAccessToken).mockReturnValue('pppppppp-pppp-4ppp-8ppp-pppppppppppp' as any);
    vi.mocked(loadGuestPurchase).mockResolvedValue({ id: 'p1', book_id: BOOK_ID } as any);
    const db = serviceDb({ books: { data: { ...LINK_BOOK, status: 'published' } }, book_links: { data: { url: LINK } } });
    vi.mocked(adminClient).mockReturnValue(db as any);
    const body = { method: 'POST', body: JSON.stringify({ access: 'token' }) };

    const opened = await guestOpen(new NextRequest('http://localhost/api/books/guest-access/open', body));
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ url: LINK, link: true });
    expect(rpc.mock.calls.some((c: any[]) => c[0] === 'take_guest_book_download')).toBe(false);
    expect(logBookDownload).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ repeatable: true }));

    const downloaded = await guestDownload(new NextRequest('http://localhost/api/books/guest-access/download', body));
    expect(downloaded.status).toBe(400);
    expect(rpc.mock.calls.some((c: any[]) => c[0] === 'take_guest_book_download')).toBe(false);
  });
});

describe('a product that stays a link or a download-only file', () => {
  it('keeps no chapters or sample settings, even when a request sends them', async () => {
    editorAs(LINK_BOOK);
    expect((await put({ id: BOOK_ID, chapters: [{ title: 'Leaked title' }], sampleSpec: { chapters: 2 } })).status).toBe(200);
    const args = saveArgs();
    expect(args.p_chapters).toEqual([]);
    expect(args.p_clear_chapters).toBe(true);
    expect(args.p_patch.sample_spec).toBeNull();

    editorAs({ ...PDF_BOOK, format: 'zip', file_path: `${BOOK_ID}/file-${U}.zip`, preview_file_path: null });
    expect((await put({ id: BOOK_ID, title: 'Kit 2' })).status).toBe(200);
    expect(saveArgs().p_chapters).toBeNull();
    expect(saveArgs().p_patch.sample_spec).toBeNull();
  });
});
