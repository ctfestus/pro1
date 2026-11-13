'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CARD_SHADOW } from '@/components/books/store/card-style';
import { EventCard } from '@/components/events/store/EventCard';
import type { PublicEvent } from '@/lib/events/public-event';

type Filter = 'all' | 'virtual' | 'in-person';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'virtual', label: 'Online' },
  { id: 'in-person', label: 'In person' },
];

/** The /events grid: upcoming first, past below, with search and an online / in person filter. */
export function EventCatalogue({ upcoming, past, primaryColor }: { upcoming: PublicEvent[]; past: PublicEvent[]; primaryColor: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const match = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (ev: PublicEvent) =>
      (filter === 'all' || ev.format === filter)
      && (!q || `${ev.title} ${ev.summary} ${ev.location ?? ''}`.toLowerCase().includes(q));
  }, [filter, query]);
  const shownUpcoming = upcoming.filter(match);
  const shownPast = past.filter(match);

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-2" role="group" aria-label="Filter events">
          {FILTERS.map(f => {
            const active = filter === f.id;
            return (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={active}
                className="h-9 px-4 rounded-full text-sm font-semibold transition-colors"
                style={active ? { background: '#0f172a', color: '#ffffff' } : { background: '#ffffff', color: '#334155', boxShadow: CARD_SHADOW }}>
                {f.label}
              </button>
            );
          })}
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search events</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#94a3b8' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events"
            className="w-full h-10 rounded-full bg-white pl-9 pr-4 text-sm outline-none"
            style={{ boxShadow: CARD_SHADOW, color: '#0f172a' }} />
        </label>
      </div>

      <h2 className="mt-8 text-xl font-bold" style={{ color: '#0f172a' }}>Upcoming</h2>
      {shownUpcoming.length ? (
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shownUpcoming.map(ev => <EventCard key={ev.id} ev={ev} primaryColor={primaryColor} />)}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-white px-6 py-12 text-center text-sm" style={{ boxShadow: CARD_SHADOW, color: '#64748b' }}>
          {upcoming.length ? 'No upcoming events match your search.' : 'No upcoming events right now. Check back soon.'}
        </div>
      )}

      {shownPast.length > 0 && (
        <>
          <h2 className="mt-12 text-xl font-bold" style={{ color: '#0f172a' }}>Past events</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shownPast.map(ev => <EventCard key={ev.id} ev={ev} primaryColor={primaryColor} />)}
          </div>
        </>
      )}
    </div>
  );
}
