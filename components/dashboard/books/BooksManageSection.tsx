'use client';

// Dashboard list of books: an author's own books, or every book for an admin. Reads through
// /api/books (service role) because reader counts come from other learners' library rows, which
// RLS rightly keeps private. Creating and editing happen in the editor at /create/book.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Edit2, Library, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { SectionEmptyState } from '@/components/dashboard/primitives';
import { resolveCoverUrl } from '@/lib/cloudinary-url';

type BookListItem = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  cover_image: string | null;
  authors: string[] | null;
  category: string | null;
  status: 'draft' | 'published' | 'archived';
  format: 'epub' | 'pdf' | 'html' | null;
  purchasable: boolean;
  available_to_everyone: boolean;
  cohort_ids: string[] | null;
  readers: number;
  completed: number;
};

type StatusFilter = 'all' | 'published' | 'draft' | 'archived';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/books', { headers: await authHeaders() });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Could not load books.');
        if (!cancelled) setBooks(d.books ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load books.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
      if (!res.ok) { window.alert(d.error || 'Could not delete the book.'); return; }
      setBooks(prev => prev.filter(b => b.id !== book.id));
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }} /></div>;
  if (error) return <div className="text-sm px-4 py-3 rounded-xl" style={{ background: 'rgba(244,63,94,0.1)', color: '#f43f5e' }}>{error}</div>;
  if (!books.length) return <SectionEmptyState Icon={Library} label="book" createHref="/create/book" createLabel="New book" C={C} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-sm" style={{ color: C.faint }}>Publish books for your cohorts, open them to everyone, or sell them.</p>
          <p className="text-xs mt-1" style={{ color: C.faint }}>{books.length} book{books.length === 1 ? '' : 's'}</p>
        </div>
        <Link href="/create/book" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4" /> New book
        </Link>
      </div>

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
            <div key={b.id} className="flex items-center gap-4 p-4 rounded-2xl" style={{ ...cardStyle(C) }}>
              <div className="w-12 h-16 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: C.pill }}>
                {cover
                  ? <img src={cover} alt="" className="w-full h-full object-cover" />
                  : <Library className="w-5 h-5" style={{ color: C.faint }} />}
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
                <p className="text-xs mt-1" style={{ color: C.faint }}>
                  {audienceLabel(b)} / {b.readers} reader{b.readers === 1 ? '' : 's'}, {b.completed} finished
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Link href={`/create/book?id=${b.id}`} className="p-2 rounded-lg transition-opacity hover:opacity-70" aria-label={`Edit ${b.title}`}
                  style={{ color: C.muted }}><Edit2 className="w-4 h-4" /></Link>
                <button onClick={() => remove(b)} disabled={deletingId === b.id} className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                  aria-label={`Delete ${b.title}`} style={{ color: '#dc2626' }}>
                  {deletingId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="py-16 text-center rounded-2xl" style={{ ...cardStyle(C) }}>
            <Search className="w-6 h-6 mx-auto mb-2" style={{ color: C.faint }} />
            <p className="text-sm font-semibold" style={{ color: C.text }}>No matching books</p>
            <p className="text-xs mt-1" style={{ color: C.faint }}>Try another search or status filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}
