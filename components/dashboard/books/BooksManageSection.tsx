'use client';

// Dashboard list of books: an author's own books, or every book for an admin. Reads through
// /api/books (service role) because sales counts come from other people's purchases, which RLS
// rightly keeps private. Creating and editing happen in the editor at /create/product. Book payments
// that need a person (wrong amount, double payment, deleted account) are listed above the books, and
// sales, free claims and downloads come from /api/books/stats (summary cards, and People per product).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, Edit2, Eye, Loader2, Megaphone, Package, Plus, Search, Trash2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { SectionEmptyState } from '@/components/dashboard/primitives';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { openBookPreview } from '@/lib/books/open-preview';
import { formatMoney, opensInBrowser } from '@/lib/books/format';
import type { BookFormat } from '@/lib/books/schema';
import { ProductPeople } from '@/components/dashboard/books/ProductPeople';
import { ProductAnnounce } from '@/components/dashboard/books/ProductAnnounce';

type BookListItem = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  cover_image: string | null;
  authors: string[] | null;
  category: string | null;
  status: 'draft' | 'published' | 'archived';
  format: BookFormat | null;
  purchasable: boolean;
  available_to_everyone: boolean;
  cohort_ids: string[] | null;
  sold: number;
  stats?: { revenue: Record<string, number>; freeClaims: number; downloads: number; downloads30d: number };
};

type StatusFilter = 'all' | 'published' | 'draft' | 'archived';

type ProductStats = { bookId: string; sold: number; revenue: Record<string, number>; freeClaims: number; downloads: number; downloads30d: number };

type AttentionItem = {
  id: string;
  bookTitle: string;
  amount: number;
  currency: string;
  reason: string;
  reference: string;
  paidAt: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
};

const REASON_LABELS: Record<string, string> = {
  amount_mismatch: 'Paid a different amount or currency than the order. No access was given.',
  already_owned: 'Paid for a product they already had. Refund the extra payment.',
  account_deleted: 'Paid, but the account was deleted before access could be given.',
  guest_previously_paid: 'A guest purchase that was paid and later changed by hand was paid for again. Access was not restored.',
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function audienceLabel(b: BookListItem): string {
  const parts: string[] = [];
  if (b.available_to_everyone) parts.push('Everyone');
  else if ((b.cohort_ids ?? []).length) parts.push(`${b.cohort_ids!.length} cohort${b.cohort_ids!.length === 1 ? '' : 's'}`);
  if (b.purchasable) parts.push('For sale');
  return parts.join(' / ') || 'Nobody yet';
}

export function BooksManageSection({ C }: { C: typeof LIGHT_C }) {
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [peopleFor, setPeopleFor] = useState<string | null>(null);
  const [announceFor, setAnnounceFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/books', { headers: await authHeaders() });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Could not load products.');
        if (!cancelled) setBooks(d.books ?? []);
        // Secondary: a failure here must not hide the books themselves.
        const pr = await fetch('/api/books/purchases', { headers: await authHeaders() }).catch(() => null);
        const pd = pr?.ok ? await pr.json().catch(() => null) : null;
        if (!cancelled && pd?.attention) setAttention(pd.attention);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load products.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Per-product figures arrive with the product list (GET /api/books), so deleting a product drops
  // its figures from the totals at the same moment.
  const stats = useMemo(() => new Map<string, ProductStats>(books.filter(b => b.stats).map(b => [b.id, { bookId: b.id, sold: b.sold, ...b.stats! }])), [books]);

  const totals = useMemo(() => {
    const t = { sold: 0, freeClaims: 0, downloads: 0, downloads30d: 0, revenue: {} as Record<string, number> };
    for (const p of stats.values()) {
      t.sold += p.sold; t.freeClaims += p.freeClaims; t.downloads += p.downloads; t.downloads30d += p.downloads30d;
      for (const [cur, amt] of Object.entries(p.revenue)) t.revenue[cur] = Math.round(((t.revenue[cur] ?? 0) + amt) * 100) / 100;
    }
    return t;
  }, [stats]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return books.filter(b => (statusFilter === 'all' || b.status === statusFilter)
      && (!term
        || b.title.toLowerCase().includes(term)
        || (b.authors ?? []).some(a => a.toLowerCase().includes(term))
        || (b.category ?? '').toLowerCase().includes(term)));
  }, [books, query, statusFilter]);

  async function remove(book: BookListItem) {
    if (!window.confirm(`Delete "${book.title}"? This cannot be undone.`)) return;
    setDeletingId(book.id);
    try {
      const res = await fetch(`/api/books?id=${encodeURIComponent(book.id)}`, { method: 'DELETE', headers: await authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { window.alert(d.error || 'Could not delete the product.'); return; }
      setBooks(prev => prev.filter(b => b.id !== book.id));
    } finally {
      setDeletingId(null);
    }
  }

  async function preview(book: BookListItem) {
    if (!book.format) return;
    setOpeningId(book.id);
    try {
      await openBookPreview(book.id, book.format, 'full');
    } catch (e: any) {
      window.alert(e?.message || 'Could not open the preview.');
    } finally {
      setOpeningId(null);
    }
  }

  async function resolve(item: AttentionItem) {
    setResolvingId(item.id);
    try {
      const res = await fetch('/api/books/purchases', {
        method: 'PATCH',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { window.alert(d.error || 'Could not update the payment.'); return; }
      setAttention(prev => prev.filter(a => a.id !== item.id));
    } finally {
      setResolvingId(null);
    }
  }

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }} /></div>;
  if (error) return <div className="text-sm px-4 py-3 rounded-xl" style={{ background: 'rgba(244,63,94,0.1)', color: '#f43f5e' }}>{error}</div>;
  if (!books.length) return <SectionEmptyState Icon={Package} label="product" createHref="/create/product" createLabel="New product" C={C} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-sm" style={{ color: C.faint }}>Publish digital products for your cohorts, open them to everyone, or sell them.</p>
          <p className="text-xs mt-1" style={{ color: C.faint }}>{books.length} product{books.length === 1 ? '' : 's'}</p>
        </div>
        <Link href="/create/product" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4" /> New product
        </Link>
      </div>

      {stats.size > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Revenue', value: Object.keys(totals.revenue).length
              ? Object.entries(totals.revenue).map(([cur, amt]) => formatMoney(amt, cur)).join(' / ') : '0', sub: 'From paid sales' },
            { label: 'Paid sales', value: String(totals.sold), sub: 'Refunds and review cases excluded' },
            { label: 'Free downloads claimed', value: String(totals.freeClaims), sub: 'Without an account' },
            { label: 'Downloads', value: String(totals.downloads), sub: `${totals.downloads30d} in the last 30 days` },
          ].map(card => (
            <div key={card.label} className="p-4 rounded-2xl" style={{ ...cardStyle(C) }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>{card.label}</p>
              <p className="text-lg font-bold mt-1 truncate" style={{ color: C.text }}>{card.value}</p>
              <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <div className="p-4 rounded-2xl space-y-3" style={{ ...cardStyle(C) }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: '#d97706' }} />
            <p className="text-sm font-semibold" style={{ color: C.text }}>
              {attention.length} book payment{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} attention
            </p>
          </div>
          {attention.map(a => (
            <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl" style={{ background: C.pill }}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>
                  {a.bookTitle} / {a.currency} {a.amount.toFixed(2)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: C.faint }}>
                  {REASON_LABELS[a.reason] ?? a.reason}
                </p>
                <p className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>
                  {[a.buyerName, a.buyerEmail].filter(Boolean).join(' / ') || 'Deleted account'} / Paystack ref {a.reference}
                  {a.paidAt ? ` / ${new Date(a.paidAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button onClick={() => resolve(a)} disabled={resolvingId === a.id}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0"
                style={{ background: C.card, color: C.text }}>
                {resolvingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Mark resolved
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 p-3 rounded-2xl" style={{ ...cardStyle(C) }}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.faint }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title, author or category"
            className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none" style={{ background: C.input, color: C.text }} />
        </div>
        <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: C.pill }}>
          {(['all', 'published', 'draft', 'archived'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className="px-3 py-2 rounded-lg text-xs font-semibold capitalize"
              style={{ background: statusFilter === f ? C.card : 'transparent', color: statusFilter === f ? C.green : C.faint }}>{f}</button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {visible.map(b => {
          const cover = b.cover_image ? resolveCoverUrl(b.cover_image) : '';
          return (
            <div key={b.id} className="p-4 rounded-2xl" style={{ ...cardStyle(C) }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-16 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: C.pill }}>
                {cover
                  ? <img src={cover} alt="" className="w-full h-full object-cover" />
                  : <Package className="w-5 h-5" style={{ color: C.faint }} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{b.title}</p>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full"
                    style={b.status === 'published'
                      ? { background: '#ffffff', color: '#16a34a', boxShadow: 'inset 0 0 0 1px #bbf7d0' }
                      : { background: C.pill, color: C.faint }}>{b.status}</span>
                  {b.format && <span className="text-[10px] font-semibold uppercase" style={{ color: C.faint }}>{b.format}</span>}
                </div>
                <p className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>
                  {[(b.authors ?? []).join(', '), b.category].filter(Boolean).join(' / ') || 'No author yet'}
                </p>
                {/* Who can get it. Sales and downloads are in the summary cards and behind People. */}
                <p className="text-xs mt-1" style={{ color: C.faint }}>{audienceLabel(b)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {b.status === 'published' && (
                  <button onClick={() => { setAnnounceFor(prev => (prev === b.id ? null : b.id)); setPeopleFor(null); }} aria-expanded={announceFor === b.id}
                    className="inline-flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-70"
                    aria-label={`Announce ${b.title}`} title="Email all students about this product" style={{ color: C.muted }}>
                    <Megaphone className="w-4 h-4" /><span className="hidden sm:inline">Announce</span>
                  </button>
                )}
                <button onClick={() => { setPeopleFor(prev => (prev === b.id ? null : b.id)); setAnnounceFor(null); }} aria-expanded={peopleFor === b.id}
                  className="inline-flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-70"
                  aria-label={`People for ${b.title}`} title="Buyers and downloads" style={{ color: C.muted }}>
                  <Users className="w-4 h-4" /><span className="hidden sm:inline">People</span>
                  <ChevronDown className="w-3.5 h-3.5 transition-transform" style={{ transform: peopleFor === b.id ? 'rotate(180deg)' : 'none' }} />
                </button>
                {b.format && (
                  <button onClick={() => preview(b)} disabled={openingId === b.id} className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                    aria-label={`Preview ${b.title}`} title={b.format === 'link' ? 'Open link' : opensInBrowser(b.format) ? 'Preview' : 'Download to check'} style={{ color: C.muted }}>
                    {openingId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
                <Link href={`/create/product?id=${b.id}`} className="p-2 rounded-lg transition-opacity hover:opacity-70" aria-label={`Edit ${b.title}`}
                  style={{ color: C.muted }}><Edit2 className="w-4 h-4" /></Link>
                <button onClick={() => remove(b)} disabled={deletingId === b.id} className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                  aria-label={`Delete ${b.title}`} style={{ color: '#dc2626' }}>
                  {deletingId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {announceFor === b.id && (
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.pill}` }}>
                <ProductAnnounce book={{ id: b.id, title: b.title, cover_image: b.cover_image }} C={C} />
              </div>
            )}
            {peopleFor === b.id && (
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.pill}` }}>
                <ProductPeople bookId={b.id} slug={b.slug} C={C} />
              </div>
            )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="py-16 text-center rounded-2xl" style={{ ...cardStyle(C) }}>
            <Search className="w-6 h-6 mx-auto mb-2" style={{ color: C.faint }} />
            <p className="text-sm font-semibold" style={{ color: C.text }}>No matching products</p>
            <p className="text-xs mt-1" style={{ color: C.faint }}>Try another search or status filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}
