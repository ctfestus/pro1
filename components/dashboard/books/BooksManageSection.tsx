'use client';

// Dashboard list of books: an author's own books, or every book for an admin. Reads through
// /api/books (service role) because sales counts come from other people's purchases, which RLS
// rightly keeps private. Creating and editing happen in the editor at /create/product. Book payments
// that need a person (wrong amount, double payment, deleted account) are listed above the books, and
// sales, free claims and downloads come from /api/books/stats (summary cards, and People per product).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Eye, Megaphone, Package, Pencil, Plus, Trash2, Users, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { openBookPreview } from '@/lib/books/open-preview';
import { formatMoney, opensInBrowser } from '@/lib/books/format';
import type { BookFormat } from '@/lib/books/schema';
import { ProductPeople } from '@/components/dashboard/books/ProductPeople';
import { ProductAnnounce } from '@/components/dashboard/books/ProductAnnounce';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { SidePanel } from '@/components/dashboard/subscriptions/Modal';
import { Card, btnClass, btnSmClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';

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

/** Who can get it: everyone or cohorts, whether it is for sale, and how many sold. */
function audienceLabel(b: BookListItem): string {
  const parts: string[] = [];
  if (b.available_to_everyone) parts.push('Everyone');
  else if ((b.cohort_ids ?? []).length) parts.push(plural(b.cohort_ids!.length, 'cohort'));
  if (b.purchasable) parts.push(b.sold ? `${b.sold} sold` : 'For sale');
  return parts.join(', ') || 'Nobody yet';
}

const STATUS_CHIPS: [StatusFilter, string][] = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']];

/** A product's People or Announce, in a panel from the right. */
export function BooksManageSection({ C: theme }: { C: typeof LIGHT_C }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const router = useRouter();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deleting, setDeleting] = useState<BookListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [peopleFor, setPeopleFor] = useState<BookListItem | null>(null);
  const [announceFor, setAnnounceFor] = useState<BookListItem | null>(null);

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

  async function remove() {
    const book = deleting!;
    setBusy(true);
    try {
      const res = await fetch(`/api/books?id=${encodeURIComponent(book.id)}`, { method: 'DELETE', headers: await authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ ok: false, text: d.error || 'Could not delete the product.' }); return; }
      setBooks(prev => prev.filter(b => b.id !== book.id));
      setNotice({ ok: true, text: `${book.title} deleted` });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  async function preview(book: BookListItem) {
    if (!book.format) return;
    try {
      await openBookPreview(book.id, book.format, 'full');
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || 'Could not open the preview.' });
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
      if (!res.ok) { setNotice({ ok: false, text: d.error || 'Could not update the payment.' }); return; }
      setAttention(prev => prev.filter(a => a.id !== item.id));
    } finally {
      setResolvingId(null);
    }
  }

  const banner = (notice || error) && (
    <div role={notice?.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
      style={notice?.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
      {notice?.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{notice?.text ?? error}</span>
      {notice && <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>}
    </div>
  );
  const revenue = Object.keys(totals.revenue).length ? Object.entries(totals.revenue).map(([cur, amt]) => formatMoney(amt, cur)).join(', ') : '0';

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Digital products" sub="Books and files to sell, or give to cohorts and everyone." C={C} actions={
        <Link href="/create/product" className={`${btnClass} no-underline`} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4" />
          New product
        </Link>
      } />
      {banner}
      {loading ? (
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.card }} />
      ) : error ? null : books.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No products yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first book or file.</p>
        </Card>
      ) : (
        <>
          {stats.size > 0 && (
            <Kpis C={C} items={[
              { label: 'Revenue', n: revenue, sub: 'From paid sales', color: C.text },
              { label: 'Paid sales', n: totals.sold, sub: 'Refunds and review cases left out', color: C.text },
              { label: 'Free downloads claimed', n: totals.freeClaims, sub: 'Without an account', color: C.text },
              { label: 'Downloads', n: totals.downloads, sub: `${totals.downloads30d} in the last 30 days`, color: C.text },
            ]} />
          )}

          {attention.length > 0 && (
            <Card C={C} className="overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
                <AlertTriangle className="w-4 h-4" style={{ color: P.warn }} />
                <p className="text-sm font-semibold" style={{ color: C.text }}>
                  {plural(attention.length, 'book payment')} need{attention.length === 1 ? 's' : ''} attention
                </p>
              </div>
              {attention.map((a, i) => (
                <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{a.bookTitle}, {formatMoney(a.amount, a.currency)}</p>
                    <p className="text-xs mt-1" style={{ color: C.muted }}>{REASON_LABELS[a.reason] ?? a.reason}</p>
                    <p className="text-xs mt-1 truncate" style={{ color: C.muted }}>
                      {[a.buyerName, a.buyerEmail].filter(Boolean).join(', ') || 'Deleted account'}, Paystack ref {a.reference}
                      {a.paidAt ? `, ${new Date(a.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => resolve(a)} disabled={resolvingId === a.id} className={btnSmClass} style={btnStyle('sec', C)}>
                    {resolvingId === a.id ? 'Saving...' : 'Mark resolved'}
                  </button>
                </div>
              ))}
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder="Search by title, author or category" C={C} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {STATUS_CHIPS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
                  style={statusFilter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <Card C={C} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: C.muted }}>No products match these filters.</p></Card>
          ) : (
            <div className={CARD_GRID}>
              {visible.map(b => (
                <ContentCard key={b.id} item={b} cover={b.cover_image} Icon={Package} reach={null} audienceText={audienceLabel(b)} C={C}
                  detail={[(b.authors ?? []).join(', '), b.category, b.format ? b.format.toUpperCase() : ''].filter(Boolean).join(', ') || 'No author yet'}
                  onOpen={() => router.push(`/create/product?id=${b.id}`)}
                  menu={(close) => [
                    ...(b.status === 'published' ? [{ label: 'Announce', sub: 'Email all students about it', icon: Megaphone, onClick: () => { close(); setAnnounceFor(b); } }] : []),
                    { label: 'People', sub: 'Buyers and downloads', icon: Users, onClick: () => { close(); setPeopleFor(b); } },
                    ...(b.format ? [{ label: b.format === 'link' ? 'Open link' : opensInBrowser(b.format) ? 'Preview' : 'Download to check', sub: 'The file learners get', icon: Eye, onClick: () => { close(); preview(b); } }] : []),
                    { label: 'Edit', sub: 'File, price and audience', icon: Pencil, onClick: () => { close(); router.push(`/create/product?id=${b.id}`); } },
                    null,
                    { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { close(); setDeleting(b); } },
                  ]} />
              ))}
            </div>
          )}
        </>
      )}

      {peopleFor && (
        <SidePanel title={peopleFor.title} sub="Buyers and downloads" onClose={() => setPeopleFor(null)} C={C}>
          <ProductPeople bookId={peopleFor.id} slug={peopleFor.slug} C={C} />
        </SidePanel>
      )}
      {announceFor && (
        <SidePanel title={announceFor.title} sub="Email all students about this product" onClose={() => setAnnounceFor(null)} C={C}>
          <ProductAnnounce book={{ id: announceFor.id, title: announceFor.title, cover_image: announceFor.cover_image }} C={C} />
        </SidePanel>
      )}
      {deleting && (
        <ConfirmModal title="Delete product?" eyebrow={deleting.title} body="This cannot be undone." action="Delete product"
          danger busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} C={C} />
      )}
    </div>
  );
}
