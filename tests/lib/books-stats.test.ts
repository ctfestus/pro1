import { describe, expect, it } from 'vitest';
import { makeSupabaseStub } from '../helpers/supabaseStub';

/** A stub whose rpc('book_download_counts') behaves like the real paged builder (order + range). */
function withPagedCounts(base: any, rows: any[], log: { ranges: [number, number][]; orders: string[] } = { ranges: [], orders: [] }) {
  return {
    ...base,
    rpc: (fn: string, _args: any, opts?: any) => {
      if (fn !== 'book_download_counts') return base.rpc(fn, _args);
      expect(opts).toEqual({ count: 'exact' });
      const q: any = {
        order: (col: string) => { log.orders.push(col); return q; },
        range: (from: number, to: number) => { log.ranges.push([from, to]); return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }); },
      };
      return q;
    },
  };
}
import { productPeople, productSummaries } from '@/lib/books/stats';

const A = 'book-a';
const B = 'book-b';

const purchases = [
  { id: 'p1', book_id: A, kind: 'sale', amount: '120.00', currency: 'GHS', paid_at: '2026-11-01T10:00:00Z', is_guest: false, guest_name: null, guest_email: null, guest_downloads_used: 0, student_id: 's1', students: { full_name: 'Kofi', email: 'kofi@x.test' } },
  { id: 'p2', book_id: A, kind: 'sale', amount: '80', currency: 'GHS', paid_at: '2026-11-02T10:00:00Z', is_guest: true, guest_name: 'Ama', guest_email: 'ama@x.test', guest_downloads_used: 2, student_id: null, students: null },
  { id: 'p3', book_id: A, kind: 'sale', amount: '10', currency: 'USD', paid_at: '2026-11-03T10:00:00Z', is_guest: true, guest_name: 'Ben', guest_email: 'ben@x.test', guest_downloads_used: 0, student_id: null, students: null },
  { id: 'p4', book_id: B, kind: 'free_claim', amount: 0, currency: 'XXX', paid_at: '2026-11-04T10:00:00Z', is_guest: true, guest_name: 'Efua', guest_email: 'efua@x.test', guest_downloads_used: 1, student_id: null, students: null },
];

describe('product sales and downloads', () => {
  it('reads the totals from the database function, in one call per 500 products', async () => {
    const calls: any[] = [];
    const db = makeSupabaseStub({}, (fn, args) => {
      calls.push({ fn, args });
      return { data: args.p_book_ids.map((id: string) => ({ book_id: id, sold: id === A ? '3' : 0, revenue: id === A ? { GHS: 200, USD: '10.00' } : {}, free_claims: id === B ? 1 : 0, downloads: 4, downloads_30d: 3 })), error: null };
    });
    const ids = [A, B, ...Array.from({ length: 600 }, (_, i) => `x${i}`)];
    const out = await productSummaries(db as any, ids);
    expect(calls.map(c => c.fn)).toEqual(['book_product_stats', 'book_product_stats']);
    expect(calls[0].args.p_book_ids).toHaveLength(500);
    expect(out[0]).toEqual({ bookId: A, sold: 3, revenue: { GHS: 200, USD: 10 }, freeClaims: 0, downloads: 4, downloads30d: 3 });
    expect(out[1]).toMatchObject({ bookId: B, sold: 0, revenue: {}, freeClaims: 1 });
    expect(out).toHaveLength(602);
  });

  it('lists buyers, guests, grants and signed-in readers with how they got it', async () => {
    const counts = [
      { student_id: 's1', purchase_id: null, downloads: 2, first_at: '2026-09-01T10:00:00Z' },
      { student_id: null, purchase_id: 'p2', downloads: 1, first_at: '2026-11-06T10:00:00Z' },
      { student_id: 's9', purchase_id: null, downloads: '1', first_at: '2026-11-07T10:00:00Z' },
    ];
    const db = makeSupabaseStub({
      book_purchases: { data: purchases.filter(p => p.book_id === A) },
      book_entitlements: { data: [{ id: 'g1', student_id: 's5', granted_at: '2026-10-01T10:00:00Z', students: { full_name: 'Yaw', email: 'yaw@x.test' } }] },
      students: { data: [{ id: 's9', full_name: 'Esi', email: 'esi@x.test' }] },
    });
    const people = await productPeople(withPagedCounts(db, counts) as any, { id: A, available_to_everyone: false });
    const by = (email: string) => people.find(p => p.email === email);
    expect(by('kofi@x.test')).toMatchObject({ kind: 'paid', guest: false, amount: 120, currency: 'GHS', downloads: 2 });
    expect(by('ama@x.test')).toMatchObject({ kind: 'paid', guest: true, amount: 80, downloads: 2 });
    expect(by('yaw@x.test')).toMatchObject({ kind: 'granted', guest: false });
    expect(by('esi@x.test')).toMatchObject({ kind: 'cohort', downloads: 1 });
    expect(people.map(p => p.date)).toEqual([...people.map(p => p.date)].sort().reverse());
  });

  it('labels signed-in readers of a free product as free', async () => {
    const db = makeSupabaseStub({
      book_purchases: { data: [] }, book_entitlements: { data: [] },
      students: { data: [{ id: 's9', full_name: 'Esi', email: 'esi@x.test' }] },
    });
    const paged = withPagedCounts(db, [{ student_id: 's9', purchase_id: null, downloads: 1, first_at: '2026-11-07T10:00:00Z' }]);
    expect((await productPeople(paged as any, { id: A, available_to_everyone: true }))[0]).toMatchObject({ kind: 'free', email: 'esi@x.test' });
  });

  it('pages download counts past the API row cap, in a stable order', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ student_id: `s${String(i).padStart(4, '0')}`, purchase_id: null, downloads: 1, first_at: '2026-11-07T10:00:00Z' }));
    const log = { ranges: [] as [number, number][], orders: [] as string[] };
    const db = makeSupabaseStub({
      book_purchases: { data: [] }, book_entitlements: { data: [] },
      // Every chunk of ids gets the full list back with its count, so each chunk's paging ends at once.
      students: { data: many.map(m => ({ id: m.student_id, full_name: 'X', email: `${m.student_id}@x.test` })), count: many.length },
    });
    const people = await productPeople(withPagedCounts(db, many, log) as any, { id: A, available_to_everyone: false });
    expect(people).toHaveLength(2500);
    expect(log.ranges.length).toBeGreaterThan(1);
    expect(log.orders.slice(0, 2)).toEqual(['student_id', 'purchase_id']);
  });
});
