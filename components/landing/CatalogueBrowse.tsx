'use client';

/**
 * A full catalogue page for one kind of content (/courses, /learning-paths, /virtual-experiences,
 * /certifications): a search box, filter chips for its groups (a course's category, an experience's
 * industry, Career or Technology) with their icons, a level filter, and the landing page's cards in
 * a grid with the same hover preview. Each filter shows only with two or more choices.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { MenuSelect } from '@/components/MenuSelect';
import { LIGHT_C } from '@/lib/theme';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { FilterChip, LEVEL_FILTER, ProgrammeCard, levelIcon, useLandingPreview, type LevelFilter } from '@/components/LandingPageClient';

const BLUE = '#3E93FF';

export function CatalogueBrowse({ items, noun, font }: { items: ProgrammeItem[]; noun: string; font?: string }) {
  const [user, setUser] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [level, setLevel] = useState<LevelFilter>('all');
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null)); }, []);
  const { openHover, scheduleClose, portal } = useLandingPreview({ typeColor: BLUE, buttonColor: BLUE, user, font });

  const groups = useMemo(() => [...new Set(items.map(item => item.category).filter((c): c is string => !!c))].sort(), [items]);
  const hasLevels = new Set(items.map(item => item.level).filter(Boolean)).size > 1;
  const q = query.trim().toLowerCase();
  const shown = items.filter(item =>
    (group === 'All' || item.category === group)
    && (level === 'all' || item.level === level)
    && (!q || [item.title, item.description, item.category, ...(item.tags ?? []), ...(item.tools ?? [])].join(' ').toLowerCase().includes(q)));

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search {noun}</span>
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: '#94a3b8' }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by title, topic or tool"
          className="field-focus h-11 w-full rounded-xl bg-white pl-10 pr-4 text-sm outline-none" style={{ color: '#0f172a' }} />
      </label>
      {(groups.length > 1 || hasLevels) && (
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {groups.length > 1 ? (
            <div className="flex w-full flex-wrap gap-2 sm:flex-1" role="group" aria-label={`Filter ${noun}`}>
              <FilterChip label="All" icon={false} on={group === 'All'} onClick={() => setGroup('All')} font={font} />
              {groups.map(name => <FilterChip key={name} label={name} on={group === name} onClick={() => setGroup(name)} font={font} />)}
            </div>
          ) : <div className="hidden sm:block sm:flex-1" />}
          {hasLevels && (
            <MenuSelect label="Filter by level" value={level} C={LIGHT_C} onChange={setLevel}
              options={LEVEL_FILTER.map(v => ({ value: v, label: v === 'all' ? 'All levels' : v, icon: levelIcon(v) }))} />
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white px-6 py-12 text-center text-sm" style={{ color: '#64748b' }}>
          {items.length ? `No ${noun} match your search.` : `No ${noun} yet. Check back soon.`}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(item => (
            <div key={item.id} className="min-w-0" onMouseEnter={e => openHover(item, e.currentTarget)} onMouseLeave={scheduleClose}>
              <ProgrammeCard item={item} user={user} hFont={font} />
            </div>
          ))}
        </div>
      )}
      {portal}
    </div>
  );
}
