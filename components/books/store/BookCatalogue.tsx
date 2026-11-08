'use client';

// The store's book grid: search and category filters run in the browser over the books the server
// already rendered (lib/books/store.ts), so filtering costs no requests.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Search } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { formatLabel, priceLabel } from '@/lib/books/format';
import type { StoreBook } from '@/lib/books/store';

const ALL = 'All';

export function BookCatalogue({ books, primaryColor }: { books: StoreBook[]; primaryColor: string }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);

  const categories = useMemo(() => {
    const set = new Set(books.map(b => b.category?.trim()).filter((c): c is string => !!c));
    return set.size > 1 ? [ALL, ...[...set].sort((a, b) => a.localeCompare(b))] : [];
  }, [books]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter(b => {
      if (category !== ALL && b.category?.trim() !== category) return false;
      if (!q) return true;
      return [b.title, b.subtitle, ...b.authors, b.category, ...b.topics, ...b.skills]
        .some(v => typeof v === 'string' && v.toLowerCase().includes(q));
    });
  }, [books, query, category]);

  if (!books.length) {
    return (
      <div className="rounded-3xl bg-white px-6 py-16 text-center">
        <BookOpen className="w-8 h-8 mx-auto" style={{ color: '#94a3b8' }} />
        <p className="mt-3 text-base font-semibold" style={{ color: '#0f172a' }}>No books yet</p>
        <p className="mt-1 text-sm" style={{ color: '#64748b' }}>New books will appear here as soon as they are published.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title, author or topic" aria-label="Search books"
            className="w-full rounded-2xl bg-white pl-10 pr-4 py-3 text-sm outline-none" style={{ color: '#0f172a' }} />
        </label>
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
            {categories.map(c => (
              <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                className="px-3.5 py-2 rounded-full text-xs font-semibold"
                style={category === c ? { background: primaryColor, color: '#ffffff' } : { background: '#ffffff', color: '#475569' }}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm py-10 text-center" style={{ color: '#64748b' }}>No books match your search.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {shown.map(book => (
            <Link key={book.id} href={`/books/${book.slug}`} className="group rounded-3xl bg-white p-3 sm:p-4 flex flex-col transition-shadow hover:shadow-lg">
              <div className="rounded-2xl overflow-hidden flex items-center justify-center" style={{ background: '#E8EEF0', aspectRatio: '3 / 4' }}>
                {book.coverImage
                  ? <img src={resolveCoverUrl(book.coverImage)} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]" />
                  : <BookOpen className="w-10 h-10" style={{ color: '#94a3b8' }} />}
              </div>
              <p className="mt-3 text-sm sm:text-base font-semibold leading-snug line-clamp-2" style={{ color: '#0f172a' }}>{book.title}</p>
              {book.authors.length > 0 && <p className="text-xs mt-1 truncate" style={{ color: '#64748b' }}>{book.authors.join(', ')}</p>}
              <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                <span className="text-sm font-bold" style={{ color: book.free ? '#16a34a' : '#0f172a' }}>{priceLabel(book)}</span>
                <span className="text-[11px]" style={{ color: '#94a3b8' }}>{formatLabel(book.format).split(' ')[0]}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
