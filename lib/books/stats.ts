import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/fetch-all-rows';

/**
 * Sales and downloads for the dashboard (instructors see their own products, admins all of them).
 *
 *   summary   per product: paid sales, revenue per currency, free claims, downloads (all time and
 *             the last 30 days)
 *   people    for one product: everyone who bought it, claimed it free, was granted it, or
 *             downloaded it through a cohort or as a free product while signed in
 *
 * Totals are computed in the database (book_product_stats and book_download_counts, migration 239),
 * so the dashboard never pulls raw purchase or download rows to count them. Purchases are paid rows
 * only (refunds and review cases are not sales); the download log starts empty: downloads before
 * it existed were never recorded.
 */

export interface ProductStats {
  bookId: string;
  sold: number;
  revenue: Record<string, number>;
  freeClaims: number;
  downloads: number;
  downloads30d: number;
}

export type PersonKind = 'paid' | 'free' | 'cohort' | 'granted';

export interface ProductPerson {
  name: string | null;
  email: string | null;
  kind: PersonKind;
  guest: boolean;
  amount: number | null;
  currency: string | null;
  date: string | null;
  downloads: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface PurchaseRow {
  id: string;
  book_id: string;
  kind: string;
  amount: number | string;
  currency: string;
  paid_at: string | null;
  is_guest: boolean;
  guest_name: string | null;
  guest_email: string | null;
  guest_downloads_used: number | null;
  student_id: string | null;
  students?: { full_name?: string | null; email?: string | null } | { full_name?: string | null; email?: string | null }[] | null;
}

async function paidPurchases(db: SupabaseClient, bookIds: string[]): Promise<PurchaseRow[]> {
  return fetchAllRowsByIds<PurchaseRow>(bookIds, (chunk, from, to) => db.from('book_purchases')
    .select('id, book_id, kind, amount, currency, paid_at, is_guest, guest_name, guest_email, guest_downloads_used, student_id, students ( full_name, email )')
    .in('book_id', chunk).eq('status', 'paid').order('id').range(from, to) as any);
}

/** Ids per database call: keeps the request well under URL and statement limits. */
const STATS_CHUNK = 500;

export async function productSummaries(db: SupabaseClient, bookIds: string[]): Promise<ProductStats[]> {
  const out: ProductStats[] = [];
  for (let i = 0; i < bookIds.length; i += STATS_CHUNK) {
    const { data, error } = await db.rpc('book_product_stats', { p_book_ids: bookIds.slice(i, i + STATS_CHUNK) });
    if (error) throw error;
    for (const r of (data ?? []) as any[]) {
      const revenue: Record<string, number> = {};
      for (const [cur, amt] of Object.entries((r.revenue ?? {}) as Record<string, unknown>)) revenue[cur] = round2(Number(amt) || 0);
      out.push({
        bookId: r.book_id,
        sold: Number(r.sold) || 0,
        revenue,
        freeClaims: Number(r.free_claims) || 0,
        downloads: Number(r.downloads) || 0,
        downloads30d: Number(r.downloads_30d) || 0,
      });
    }
  }
  return out;
}

/** Everyone who has the product, most recent first. */
export async function productPeople(
  db: SupabaseClient,
  book: { id: string; available_to_everyone: boolean | null },
): Promise<ProductPerson[]> {
  const [purchases, counts, grants] = await Promise.all([
    paidPurchases(db, [book.id]),
    // Paged with a stable order: one row per person, and the API caps each response (about 1,000).
    fetchAllRows<{ student_id: string | null; purchase_id: string | null; downloads: number | string; first_at: string }>(
      (from, to) => db.rpc('book_download_counts', { p_book_id: book.id }, { count: 'exact' })
        .order('student_id', { ascending: true, nullsFirst: false })
        .order('purchase_id', { ascending: true, nullsFirst: false })
        .range(from, to) as any,
    ),
    fetchAllRowsByIds<any>([book.id], (chunk, from, to) => db.from('book_entitlements')
      .select('id, student_id, granted_at, students ( full_name, email )')
      .in('book_id', chunk).eq('source', 'grant').is('revoked_at', null).order('id').range(from, to) as any),
  ]);

  const accountDownloads = new Map<string, { count: number; first: string }>();
  for (const c of counts) {
    if (!c.student_id) continue;
    const d = accountDownloads.get(c.student_id);
    const count = Number(c.downloads) || 0;
    if (d) { d.count += count; if (c.first_at < d.first) d.first = c.first_at; }
    else accountDownloads.set(c.student_id, { count, first: c.first_at });
  }
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

  const people: ProductPerson[] = [];
  const seen = new Set<string>();
  for (const p of purchases) {
    const student = one(p.students);
    if (p.student_id) seen.add(p.student_id);
    people.push({
      name: p.is_guest ? p.guest_name : student?.full_name ?? null,
      email: p.is_guest ? p.guest_email : student?.email ?? null,
      kind: p.kind === 'free_claim' ? 'free' : 'paid',
      guest: p.is_guest,
      amount: p.kind === 'free_claim' ? null : Number(p.amount),
      currency: p.kind === 'free_claim' ? null : p.currency,
      date: p.paid_at,
      downloads: p.is_guest ? Number(p.guest_downloads_used) || 0 : accountDownloads.get(p.student_id ?? '')?.count ?? 0,
    });
  }
  for (const g of grants as any[]) {
    if (!g.student_id || seen.has(g.student_id)) continue;
    seen.add(g.student_id);
    const student = one(g.students) as { full_name?: string | null; email?: string | null } | null;
    people.push({
      name: student?.full_name ?? null, email: student?.email ?? null, kind: 'granted', guest: false,
      amount: null, currency: null, date: g.granted_at, downloads: accountDownloads.get(g.student_id)?.count ?? 0,
    });
  }
  // Signed-in readers with no purchase or grant: a free product, or one assigned to their cohort.
  const others = [...accountDownloads.keys()].filter(id => !seen.has(id));
  if (others.length) {
    const students = await fetchAllRowsByIds<{ id: string; full_name: string | null; email: string | null }>(
      others, (chunk, from, to) => db.from('students').select('id, full_name, email').in('id', chunk).order('id').range(from, to) as any,
    );
    const byId = new Map(students.map(s => [s.id, s]));
    for (const id of others) {
      const d = accountDownloads.get(id)!;
      people.push({
        name: byId.get(id)?.full_name ?? null, email: byId.get(id)?.email ?? null,
        kind: book.available_to_everyone ? 'free' : 'cohort', guest: false,
        amount: null, currency: null, date: d.first, downloads: d.count,
      });
    }
  }
  return people.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}
