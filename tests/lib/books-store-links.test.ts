import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => { throw new Error('tests pass a db'); } }));

import { readFileSync } from 'node:fs';
import { storeBlockers, toStoreBook } from '@/lib/books/store';

const ID = '11111111-1111-4111-8111-111111111111';
const row = {
  id: ID, slug: 'canva-kit', title: 'Canva kit', status: 'published', format: 'link', file_path: null, preview_file_path: null,
  purchasable: true, available_to_everyone: false, license_expires_at: null, authors: [], topics: [], skills: [],
};

describe('link products in the store (migration 243)', () => {
  it('are listed like any product, with no sample', () => {
    const book = toStoreBook(row, [{ currency: 'GHS', amount: 50 }])!;
    expect(book).toMatchObject({ id: ID, format: 'link', hasSample: false });
    expect(storeBlockers(row, [{ currency: 'GHS', amount: 50 }])).toEqual([]);
  });

  it('never read the address: the store does not touch book_links', () => {
    const src = readFileSync(`${process.cwd()}/lib/books/store.ts`, 'utf8');
    expect(src).not.toContain('book_links');
    for (const f of ['app/api/books/library/route.ts', 'app/api/student/catalogue/route.ts', 'lib/books/share.ts', 'lib/books/receipt-email.ts', 'lib/books/announce.ts']) {
      expect(readFileSync(`${process.cwd()}/${f}`, 'utf8')).not.toContain('book_links');
    }
  });
});
