import { describe, expect, it, vi } from 'vitest';
import {
  bookColumnsFromInput,
  bookSlug,
  chaptersFromInput,
  commercialFromInput,
  verifyUploadedObject,
} from '@/lib/books/admin';

const BOOK_ID = 'abcdef12-3456-4abc-8def-abcdef123456';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COHORT = '11111111-1111-4111-8111-111111111111';

describe('bookColumnsFromInput', () => {
  it('maps only the keys that were sent', () => {
    expect(bookColumnsFromInput({ title: '  SQL  ' })).toEqual({ title: 'SQL' });
    expect(bookColumnsFromInput({})).toEqual({});
  });

  it('never lets commercial or ownership columns through', () => {
    const out = bookColumnsFromInput({
      purchasable: true, royalty_pct: 90, royaltyPct: 90, user_id: 'x', status: 'published',
      file_path: 'x', format: 'pdf', slug: 'hijack',
    });
    expect(out).toEqual({});
  });

  it('cleans lists, dropping blanks and duplicates', () => {
    expect(bookColumnsFromInput({ authors: [' Ada ', '', 'ada', 'Grace', 7] }).authors).toEqual(['Ada', 'Grace']);
  });

  it('keeps an open book free of cohorts, as the database CHECK requires', () => {
    expect(bookColumnsFromInput({ availableToEveryone: true, cohortIds: [COHORT] }))
      .toEqual({ available_to_everyone: true, cohort_ids: [] });
    expect(bookColumnsFromInput({ availableToEveryone: false, cohortIds: [COHORT, 'not-a-uuid', COHORT.toUpperCase()] }))
      .toEqual({ available_to_everyone: false, cohort_ids: [COHORT] });
  });

  it('accepts only known enums, web links and real dates', () => {
    const out = bookColumnsFromInput({
      difficulty: 'expert', licenseType: 'stolen', licenseUrl: 'javascript:alert(1)', licenseExpiresAt: 'soon',
    });
    expect(out).toEqual({ difficulty: null, license_type: null, license_url: null, license_expires_at: null });
    expect(bookColumnsFromInput({ licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }).license_url)
      .toBe('https://creativecommons.org/licenses/by/4.0/');
  });
});

describe('commercial terms', () => {
  it('normalizes prices: one per currency, positive, two decimals', () => {
    expect(commercialFromInput({ prices: [
      { currency: 'ghs', amount: '50.005' }, { currency: 'GHS', amount: 60 }, { currency: 'US', amount: 5 },
      { currency: 'NGN', amount: 0 }, { currency: 'USD', amount: 'free' },
    ] }).prices).toEqual([{ currency: 'GHS', amount: 60 }]);
  });

  it('clamps royalty to 0..100', () => {
    expect(commercialFromInput({ royaltyPct: 150 }).royaltyPct).toBe(100);
    expect(commercialFromInput({ royaltyPct: -3 }).royaltyPct).toBe(0);
  });
});

describe('chaptersFromInput', () => {
  it('keeps only the locator shape of the book format', () => {
    const raw = [{ title: 'One', locator: { href: 'ch1.xhtml', pageStart: 3, anchor: 'one' } }];
    expect((chaptersFromInput(raw, 'epub') as any)[0].locator).toEqual({ href: 'ch1.xhtml' });
    expect((chaptersFromInput(raw, 'pdf') as any)[0].locator).toEqual({ pageStart: 3 });
    expect((chaptersFromInput(raw, 'html') as any)[0].locator).toEqual({ anchor: 'one' });
  });

  it('drops a PDF end page before its start, and unsafe HTML anchors', () => {
    expect((chaptersFromInput([{ title: 'A', locator: { pageStart: 9, pageEnd: 4 } }], 'pdf') as any)[0].locator).toEqual({ pageStart: 9 });
    expect((chaptersFromInput([{ title: 'A', locator: { anchor: '"><script>' } }], 'html') as any)[0].locator).toEqual({});
  });

  it('keeps existing chapter ids so progress survives, and ignores junk ids', () => {
    const out = chaptersFromInput([{ id: U.toUpperCase(), title: 'A' }, { id: 'nope', title: 'B' }], 'epub') as any[];
    expect(out[0].id).toBe(U);
    expect(out[1]).not.toHaveProperty('id');
  });

  it('refuses the same chapter listed twice', () => {
    expect(chaptersFromInput([{ id: U, title: 'A' }, { id: U.toUpperCase(), title: 'B' }], 'epub'))
      .toEqual({ error: 'Chapter 2 is listed twice.' });
  });

  it('refuses an untitled chapter with a sentence the editor can show', () => {
    expect(chaptersFromInput([{ title: 'A' }, { title: '  ' }], 'epub')).toEqual({ error: 'Chapter 2 needs a title.' });
    expect(chaptersFromInput('nope', 'epub')).toEqual({ error: 'Chapters must be a list.' });
  });
});

describe('verifyUploadedObject', () => {
  function storage(info: any) {
    const remove = vi.fn(async () => ({ data: null, error: null }));
    return { remove, db: { storage: { from: () => ({ info: vi.fn(async () => info), remove }) } } };
  }
  const path = `${BOOK_ID}/file-${U}.html`;

  it('accepts a real upload and reports its stored size', async () => {
    const { db } = storage({ data: { size: 2048, contentType: 'text/html' }, error: null });
    expect(await verifyUploadedObject(db, BOOK_ID, path, 'file', 'html')).toEqual({ size: 2048 });
  });

  it('refuses a path from another book without touching storage', async () => {
    const { db, remove } = storage({ data: { size: 1 }, error: null });
    const other = `22222222-2222-4222-8222-222222222222/file-${U}.html`;
    expect(await verifyUploadedObject(db, BOOK_ID, other, 'file', 'html')).toEqual({ error: 'That upload does not belong to this product.' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes and refuses an HTML file whose real size is over 10 MB, whatever the browser declared', async () => {
    const { db, remove } = storage({ data: { size: 40 * 1024 * 1024, contentType: 'text/html' }, error: null });
    const r = await verifyUploadedObject(db, BOOK_ID, path, 'file', 'html');
    expect(r).toEqual({ error: 'The file is larger than 10 MB.' });
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it('deletes and refuses a file of the wrong type', async () => {
    const { db, remove } = storage({ data: { size: 100, contentType: 'application/pdf' }, error: null });
    expect(await verifyUploadedObject(db, BOOK_ID, path, 'file', 'html')).toEqual({ error: 'The uploaded file is not the expected type.' });
    expect(remove).toHaveBeenCalled();
  });

  it('refuses an object that was never uploaded', async () => {
    const { db } = storage({ data: null, error: { message: 'not found' } });
    expect(await verifyUploadedObject(db, BOOK_ID, path, 'file', 'html')).toEqual({ error: 'The uploaded file was not found. Upload it again.' });
  });
});

describe('bookSlug', () => {
  it('makes a readable slug with a unique tail', () => {
    expect(bookSlug('SQL for Data Analysts: 2nd Ed.', 'a1b2')).toBe('sql-for-data-analysts-2nd-ed-a1b2');
    expect(bookSlug('!!!', 'a1b2')).toBe('a1b2');
  });
});

describe('recommended courses', () => {
  it('keeps distinct course ids, lowercased, at most 20, and drops anything else', () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const many = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(bookColumnsFromInput({ recommendedCourseIds: [A.toUpperCase(), A, 'nope', 5, null] }).recommended_course_ids).toEqual([A]);
    expect((bookColumnsFromInput({ recommendedCourseIds: many }).recommended_course_ids as string[]).length).toBe(20);
    expect(bookColumnsFromInput({ recommendedCourseIds: 'x' }).recommended_course_ids).toEqual([]);
    expect(bookColumnsFromInput({ title: 'T' })).not.toHaveProperty('recommended_course_ids');
  });
});
