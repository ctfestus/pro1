'use client';

// The store's book grid: search and category filters run in the browser over the books the server
// already rendered (lib/books/store.ts), so filtering costs no requests.

import { useMemo, useState } from 'react';
import { Package, Search } from 'lucide-react';
import { ProductCard } from '@/components/books/store/ProductCard';
import type { StoreBook } from '@/lib/books/store';

const ALL = 'All';

export function BookCatalogue({ books }: { books: StoreBook[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [kind, setKind] = useState(ALL);

  const categories = useMemo(() => {
    const set = new Set(books.map(b => b.category?.trim()).filter((c): c is string => !!c));
    return set.size > 1 ? [ALL, ...[...set].sort((a, b) => a.localeCompare(b))] : [];
  }, [books]);

  // Kinds of product in the store (migration 242), offered as filters once there is more than one.
  const kinds = useMemo(() => {
    const set = new Set(books.map(b => b.productTypeLabel).filter(Boolean));
    return set.size > 1 ? [ALL, ...[...set].sort((a, b) => a.localeCompare(b))] : [];
  }, [books]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter(b => {
      if (category !== ALL && b.category?.trim() !== category) return false;
      if (kind !== ALL && b.productTypeLabel !== kind) return false;
      if (!q) return true;
      return [b.title, b.subtitle, ...b.authors, b.category, b.productTypeLabel, ...b.topics, ...b.skills]
        .some(v => typeof v === 'string' && v.toLowerCase().includes(q));
    });
  }, [books, query, category, kind]);

  if (!books.length) {
    return (
      <div className="rounded-3xl bg-white px-6 py-16 text-center">
        <Package className="w-8 h-8 mx-auto" style={{ color: '#94a3b8' }} />
        <p className="mt-3 text-base font-semibold" style={{ color: '#0f172a' }}>No products yet</p>
        <p className="mt-1 text-sm" style={{ color: '#64748b' }}>New digital products will appear here as soon as they are published.</p>
      </div>
    );
  }

  // One chip style: the chosen chip in the primary blue.
  const chip = (on: boolean) => on ? { background: '#3E93FF', color: '#ffffff' } : { background: '#ffffff', color: '#334155' };

  return (
    <div className="space-y-5">
      <label className="relative block">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: '#94a3b8' }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title, author or topic" aria-label="Search products"
          className="field-focus w-full rounded-xl bg-white py-3 pl-10 pr-4 text-sm outline-none" style={{ color: '#0f172a' }} />
      </label>
      {(categories.length > 0 || kinds.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
              {categories.map(c => (
                <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                  className="h-9 rounded-full px-4 text-sm font-semibold" style={chip(category === c)}>{c}</button>
              ))}
            </div>
          )}
          {kinds.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Product types">
              {kinds.map(k => (
                <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                  className="h-9 rounded-full px-4 text-sm font-semibold" style={chip(kind === k)}>{k === ALL ? 'All types' : k}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: '#64748b' }}>No products match your search.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {shown.map(book => <ProductCard key={book.id} book={book} />)}
        </div>
      )}
    </div>
  );
}
