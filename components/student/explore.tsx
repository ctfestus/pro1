'use client';

/**
 * Explore: the whole catalogue, with a padlock on anything the student cannot open.
 *
 * Deliberately a SEPARATE section from My Learning. My Learning answers "what do I do next" and
 * padlocks would only clutter it. This answers "what else is there", which is a different question
 * and, for a free account, the upsell surface.
 *
 * The card treatment matches the landing page on purpose -- the flex-expand hover, the image scale,
 * the badge and the arrow -- so somebody who signed up from the marketing site meets the same
 * visual language inside the product.
 *
 * The padlock is a HINT, not the enforcement. Locked content is refused by the database (RLS on
 * courses and virtual_experiences), and /api/student/catalogue returns display fields only, so a
 * locked card carries no course content to leak.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Lock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { LIGHT_C } from '@/lib/theme';
import type { SectionId } from '@/components/student/nav';

type CatalogueType = 'course' | 'learning_path' | 'virtual_experience' | 'certification';

interface CatalogueItem {
  id: string;
  type: CatalogueType;
  title: string;
  coverImage: string | null;
  description: string | null;
  category: string | null;
  locked: boolean;
}

const TYPE_LABEL: Record<CatalogueType, string> = {
  course:              'Course',
  learning_path:       'Learning Path',
  virtual_experience:  'Virtual Experience',
  certification:       'Certification',
};

// Where an unlocked card sends the student. Deep links into players are deliberately avoided --
// each of these sections already knows how to open its own content, deadlines and attempts.
const TYPE_SECTION: Record<CatalogueType, SectionId> = {
  course:              'courses',
  learning_path:       'learning_paths',
  virtual_experience:  'virtual_experiences',
  certification:       'certifications',
};

const FILTERS: { value: 'all' | CatalogueType; label: string }[] = [
  { value: 'all',                label: 'All content' },
  { value: 'course',             label: 'Courses' },
  { value: 'learning_path',      label: 'Learning Paths' },
  { value: 'virtual_experience', label: 'Virtual Experiences' },
  { value: 'certification',      label: 'Certifications' },
];

const PAGE = 3;

export function ExploreSection({ C, onNavigate }: {
  C: typeof LIGHT_C;
  onNavigate?: (section: SectionId) => void;
}) {
  const { primaryColor, accentColor } = useTenant();
  const brand  = primaryColor || '#2563eb';
  const accent = accentColor  || '#f59e0b';

  const [items,   setItems]   = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [filter,  setFilter]  = useState<'all' | CatalogueType>('all');
  const [page,    setPage]    = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/student/catalogue', {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load the catalogue.');
        setItems(Array.isArray(json.items) ? json.items : []);
      } catch (e: any) {
        setError(e?.message || 'Could not load the catalogue.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter(i => i.type === filter)),
    [items, filter],
  );

  // Unlocked first: what they can actually start matters more than what they cannot.
  const ordered = useMemo(
    () => [...visible].sort((a, b) => Number(a.locked) - Number(b.locked)),
    [visible],
  );

  const open = (item: CatalogueItem) => {
    if (item.locked) return;
    onNavigate?.(TYPE_SECTION[item.type]);
  };

  const card = (item: CatalogueItem, i: number, expanded: boolean) => (
    <>
      <div className="absolute inset-0" style={{
        background: item.coverImage
          ? `url(${item.coverImage}) center/cover`
          : `linear-gradient(160deg, ${brand}, #0f172a)`,
        transform: expanded ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
        filter: item.locked ? 'grayscale(0.85)' : 'none',
      }} />
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0) 100%)',
      }} />

      <div className="absolute inset-0 p-5 md:p-6 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md"
            style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(6px)' }}>
            {TYPE_LABEL[item.type]}
          </span>
          {item.locked && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md"
              style={{ background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(6px)' }}>
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
        </div>

        <div className="space-y-3">
          <div style={{
            maxHeight: expanded ? 120 : 0,
            opacity: expanded ? 1 : 0,
            overflow: 'hidden',
            transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease',
            transitionDelay: expanded ? '0.1s' : '0s',
          }}>
            {item.description && (
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.78)' }}>
                {item.description}
              </p>
            )}
            {item.locked && (
              <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Not part of your access yet.
              </p>
            )}
          </div>

          <div className="flex items-end justify-between gap-4">
            <h3 className="font-black leading-tight" style={{
              color: '#ffffff',
              fontSize: expanded ? 22 : 17,
              transition: 'font-size 0.3s ease',
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {item.title}
            </h3>
            <div style={{
              opacity: expanded ? 1 : 0,
              transform: expanded ? 'scale(1)' : 'scale(0.6)',
              transition: 'opacity 0.3s ease, transform 0.3s ease',
              transitionDelay: expanded ? '0.15s' : '0s',
              flexShrink: 0,
            }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: item.locked ? 'rgba(255,255,255,0.18)' : accent }}>
                {item.locked
                  ? <Lock className="w-4 h-4 text-white" />
                  : <ArrowRight className="w-4 h-4 text-white" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  const pageItems = ordered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold" style={{ color: C.text }}>Explore</h2>
          <p className="text-sm" style={{ color: C.muted }}>
            Everything on the platform. Locked items are not part of your access yet.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value as 'all' | CatalogueType); setPage(0); setHovered(null); }}
            aria-label="Filter by content type"
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
          >
            {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          {ordered.length > PAGE && (
            <div className="hidden md:flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setPage(p => Math.max(0, p - 1)); setHovered(null); }}
                disabled={page === 0}
                aria-label="Previous"
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.text }}
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => { setPage(p => Math.min(pages - 1, p + 1)); setHovered(null); }}
                disabled={page >= pages - 1}
                aria-label="Next"
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30"
                style={{ background: brand, color: '#ffffff' }}
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.muted }} />
        </div>
      )}

      {!loading && error && (
        <p className="text-sm py-10 text-center" style={{ color: C.muted }}>{error}</p>
      )}

      {!loading && !error && ordered.length === 0 && (
        <p className="text-sm py-10 text-center" style={{ color: C.muted }}>
          Nothing published in this category yet.
        </p>
      )}

      {!loading && !error && ordered.length > 0 && (
        <>
          {/* Mobile: horizontal snap scroll. Hover does not exist on touch, so every card shows
              its detail rather than hiding it behind an interaction that cannot happen. */}
          <div className="md:hidden overflow-x-auto pb-4 -mx-4" style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}>
            <div className="flex gap-3 px-4">
              {ordered.map((item, i) => (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => open(item)}
                  className="relative flex-shrink-0 rounded-2xl overflow-hidden"
                  style={{
                    width: '80vw', maxWidth: 320, height: 360,
                    scrollSnapAlign: 'start',
                    cursor: item.locked ? 'default' : 'pointer',
                  }}
                >
                  {card(item, i, true)}
                </div>
              ))}
              <div className="flex-shrink-0 w-1" />
            </div>
          </div>

          {/* Desktop: flex-expand, same treatment as the landing page. */}
          <div className="hidden md:flex gap-4 items-stretch" onMouseLeave={() => setHovered(null)}>
            {pageItems.map((item, i) => {
              const expanded = hovered === i || (hovered === null && i === 0);
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onMouseEnter={() => setHovered(i)}
                  onClick={() => open(item)}
                  className="relative rounded-2xl overflow-hidden"
                  style={{
                    flex: expanded ? '2.2 0 0' : '1 0 0',
                    minWidth: 0,
                    height: 440,
                    transition: 'flex 0.45s cubic-bezier(0.4,0,0.2,1)',
                    cursor: item.locked ? 'default' : 'pointer',
                  }}
                >
                  {card(item, i, expanded)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
