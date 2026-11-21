'use client';

/**
 * Explore: the whole catalogue, with a padlock on anything the student cannot open.
 *
 * Deliberately a SEPARATE section from My Learning. My Learning answers "what do I do next";
 * padlocks there would only clutter it. This answers "what else is there", which for a free
 * self-serve account is the upsell surface. No existing student's My Learning changes.
 *
 * The card treatment follows the landing page's MODERN template -- titled carousel rows, aspect-video
 * thumbnails that lift while the image scales, the shine sweep, and a hover-pop preview on desktop --
 * so somebody arriving from the marketing site meets the same visual language inside the product.
 * HoverPreviewCard is the same shared component the landing page and CertificationTaker use, so the
 * popover placement behaviour cannot drift from theirs.
 *
 * The padlock is a HINT, not the enforcement. Locked content is refused by the database (RLS on
 * courses and virtual_experiences), and /api/student/catalogue returns display fields only, so a
 * locked card carries no course content to leak.
 */
import { useEffect, useMemo, useState, type ElementType } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { Gift, Globe, LayoutGrid, Lock, Loader2, Search } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { HoverPreviewCard } from '@/components/student/shared';
import { CardMeta, FRAMED_CARD } from '@/components/CardMeta';
import { CataloguePreview, TYPE_ICON, resolvedCover, type CatalogueItem, type CatalogueType } from '@/components/CataloguePreview';
import { useHoverPreview } from '@/lib/use-hover-preview';
import { LIGHT_C } from '@/lib/theme';
import { matchesSearch } from '@/lib/plain-text';
import { useToolIcons } from '@/lib/use-tool-icons';
import type { SectionId } from '@/components/student/nav';
import { groupCatalogue, type ExploreAccess } from '@/lib/explore-filter';
import { PriceTag } from '@/components/books/store/PriceTag';

const ROW_TITLE: Record<CatalogueType, string> = {
  course:             'Courses',
  learning_path:      'Learning paths',
  virtual_experience: 'Virtual experiences',
  certification:      'Certifications',
  book:               'Digital products',
};

const TYPE_ORDER: CatalogueType[] = ['course', 'learning_path', 'virtual_experience', 'certification', 'book'];
const INITIAL_VISIBLE = 8;
const LOAD_MORE_STEP = 8;

// What a learner can open now, versus what a plan would open. Two different questions from the
// type filter, so a separate control rather than more entries in the same row.
const ACCESS_ICON: Record<ExploreAccess, ElementType> = { all: Globe, free: Gift, paid: Lock };

const ACCESS_FILTERS: { value: ExploreAccess; label: string }[] = [
  { value: 'all',  label: 'All access' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
];

const FILTERS: { value: 'all' | CatalogueType; label: string }[] = [
  { value: 'all',                label: 'All content' },
  { value: 'course',             label: 'Courses' },
  { value: 'learning_path',      label: 'Learning paths' },
  { value: 'virtual_experience', label: 'Virtual experiences' },
  { value: 'certification',      label: 'Certifications' },
  { value: 'book',               label: 'Digital products' },
];

// Every card is a real link, so middle-click, open-in-new-tab and copy-link work everywhere.
// Every type opens its detail page, the same one the landing page links to. A learning path links
// by id, as the landing page does; starting it from there opens it in My Learning.
// Books open their store page (/books/[slug]), where the learner can buy, read the sample, or
// download one they already have. A book they have only through their program is not in the
// store, so it opens My Books, where it is listed for download.
const directHref = (item: CatalogueItem) =>
  item.type === 'book'
    ? (item.inStore === false ? '/student#products' : `/products/${encodeURIComponent(item.slug || item.id)}`)
    : item.type === 'learning_path'
      ? `/${encodeURIComponent(item.id)}?catalogueType=learning_path`
      : `/${item.slug || item.id}?catalogueType=${encodeURIComponent(item.type)}`;


export function ExploreSection({ C }: {
  C: typeof LIGHT_C;
  onNavigate?: (section: SectionId) => void;
}) {
  const { accentColor } = useTenant();
  const typeColor: Record<CatalogueType, string> = {
    // C.cta, not the raw tenant colour: the palette already resolves to the tenant primary in
    // light and to the ocean blue in dark, which is the convention everywhere else. Reading
    // primaryColor directly put the light-mode brand blue on a dark page.
    course:             C.cta,
    learning_path:      accentColor  || '#FF9933',
    virtual_experience: '#00BF63',
    certification:      '#0891B2',
    book:               '#C2410C',
  };

  const [items,   setItems]   = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [filter,  setFilter]  = useState<'all' | CatalogueType>('all');
  const [access,  setAccess]  = useState<ExploreAccess>('all');
  const [search,  setSearch]  = useState('');

  const { hover, open: openPreview, scheduleClose, cancelClose, close: closeHover } = useHoverPreview<CatalogueItem>();

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

  // Locked items used to be sorted to the end of every row. With eight cards shown before
  // "show more", a learner with eight free courses saw no paid ones at all -- not lower down,
  // clipped out -- so the catalogue looked like whatever they already had. The sort did nothing
  // for a subscriber, who has everything unlocked, and hid the rest from everyone else. Anyone
  // who only wants what they can start now picks Free above, which is a choice they can see.
  const grouped = useMemo(
    () => groupCatalogue(items.filter(i => matchesSearch(search, i.title, i.description, i.category)), TYPE_ORDER, filter, access) as Map<CatalogueType, CatalogueItem[]>,
    [items, filter, access, search],
  );

  const isLight = C.page === LIGHT_C.page;
  // White fields with a thin border that darkens on focus, like My Learning's search.
  const fieldStyle = {
    background: C.card,
    ['--explore-line' as string]: C.cardBorder,
    ['--explore-focus' as string]: isLight ? '#b6bcc6' : 'rgba(255,255,255,0.28)',
  };

  const open = (item: CatalogueItem) => {
    closeHover();
    window.location.href = directHref(item);
  };

  const openHover = (item: CatalogueItem, el: HTMLElement) => openPreview(item, el, {
    width: 340,
    height: 560,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {/* Type on the left, access on the right of the same line. Access began as a second row
            of pills and read as more of the same control, when it asks a different question --
            which kind of thing, against what I can open. A select next to a segmented control
            says "these are not the same" without a word of explanation, and on a narrow screen
            it wraps below while still looking like its own thing. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Type and access as two menus on the left, search on the right. */}
        <div className="flex flex-wrap items-center gap-2">
          <MenuSelect label="Content type" value={filter} C={C}
            options={FILTERS.map(f => ({ ...f, icon: f.value === 'all' ? LayoutGrid : TYPE_ICON[f.value] }))}
            onChange={v => { setFilter(v); closeHover(); }} />
          <MenuSelect label="Show by access" value={access} C={C}
            options={ACCESS_FILTERS.map(f => ({ ...f, icon: ACCESS_ICON[f.value] }))}
            onChange={v => { setAccess(v); closeHover(); }} />
        </div>

        <div className="flex w-full items-center sm:w-auto">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--explore-line)] px-3 py-2 transition-colors focus-within:border-[var(--explore-focus)] sm:w-60 sm:flex-none"
            style={fieldStyle}>
            <Search className="h-4 w-4 flex-shrink-0" style={{ color: C.faint }} />
            <input value={search} onChange={e => { setSearch(e.target.value); closeHover(); }} placeholder="Search the catalogue"
              aria-label="Search the catalogue" className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:!outline-none" style={{ color: C.text }} />
          </label>
        </div>
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

      {!loading && !error && grouped.size === 0 && (
        <p className="text-sm py-10 text-center" style={{ color: C.muted }}>
          {access === 'paid'
            ? 'Everything here is already open to you.'
            : access === 'free'
              ? 'Nothing here is free to start yet.'
              : 'Nothing published in this category yet.'}
        </p>
      )}

      {!loading && !error && [...grouped.entries()].map(([type, list]) => (
        <CatalogueRow
          key={type}
          title={ROW_TITLE[type]}
          type={type}
          items={list}
          C={C}
          accent={typeColor[type]}
          onOpen={open}
          onHover={openHover}
          onHoverLeave={scheduleClose}
        />
      ))}

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {hover && (
            <HoverPreviewCard
              key={`${hover.item.type}:${hover.item.id}`}
              left={hover.left}
              top={hover.top}
              originX={hover.originX}
              originY={hover.originY}
              width={hover.width}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <CataloguePreview item={hover.item} accent={typeColor[hover.item.type]} href={directHref(hover.item)} onOpen={open} compact C={C} />
            </HoverPreviewCard>
          )}
        </AnimatePresence>,
        document.body,
      )}

    </div>
  );
}

function CatalogueRow({ title, type, items, C, accent, onOpen, onHover, onHoverLeave }: {
  title: string;
  type: CatalogueType;
  items: CatalogueItem[];
  C: typeof LIGHT_C;
  accent: string;
  onOpen: (item: CatalogueItem) => void;
  onHover: (item: CatalogueItem, el: HTMLElement) => void;
  onHoverLeave: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const toolIcon = useToolIcons();
  const Icon = TYPE_ICON[type];
  const visibleItems = items.slice(0, visibleCount);
  const remaining = Math.max(0, items.length - visibleItems.length);

  return (
    // Cards on the page itself, each its own white card, as on the landing page.
    <section>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0" style={{ background: `${accent}16` }}>
            <Icon className="w-[15px] h-[15px]" style={{ color: accent }} />
          </span>
          <h3 className="text-[22px] leading-7 font-bold truncate" style={{ color: C.text }}>
            {title}
          </h3>
        </div>
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: C.faint }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 pt-4">
        {visibleItems.map(item => (
          <div
            key={item.id}
            className="min-w-0"
            onMouseEnter={e => onHover(item, e.currentTarget)}
            onMouseLeave={onHoverLeave}
          >
            {(() => {
              const coverUrl = resolvedCover(item.coverImage);
              const href = directHref(item);
              const inner = (
                <>
                  <div className="relative overflow-hidden w-full aspect-video" style={{ background: coverUrl ? '#0b0b0d' : C.pill }}>
                    {coverUrl
                      ? <img src={coverUrl} alt={item.title} loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
                      : <div className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-[1.07]">
                          {/* No cover: the tool's logo on soft grey, or the type's icon. */}
                          {item.category && toolIcon(item.category)
                            ? <img src={toolIcon(item.category)!} alt="" className="h-12 w-12 object-contain" />
                            : (() => { const Icon = TYPE_ICON[type]; return <Icon className="w-8 h-8" style={{ color: C.faint }} />; })()}
                        </div>
                    }

                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{ background: 'linear-gradient(to top, rgba(1,15,35,0.42), transparent 55%)' }} />

                    {item.category && (
                      <span className="absolute left-0 top-3 max-w-[70%] truncate px-3 py-1 text-[11px] font-bold"
                        style={{ background: '#F5D77A', color: '#3d2e00' }}>
                        {item.category}
                      </span>
                    )}
                    {item.locked && (
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold"
                        style={{ background: '#ffffff', color: '#111111' }}>
                        <Lock className="h-3 w-3" /> Locked
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-[18px]">
                    {/* Two lines kept for the title, so the details line up across a row. */}
                    <p className="text-[15px] leading-5 min-h-[40px] font-bold line-clamp-2" style={{ color: C.text }}>
                      {item.title}
                    </p>
                    {item.locked && item.prices?.length ? (
                      <PriceTag prices={item.prices} className="block text-sm font-bold mt-1" style={{ color: C.text }} />
                    ) : null}
                    {/* A path shows its skills as tags and its item count where the level goes. */}
                    <CardMeta tags={item.type === 'learning_path' ? item.skills : item.topics} level={item.level} tools={item.tools}
                      note={item.type === 'learning_path' && item.pathItems?.length ? `${item.pathItems.length} learning item${item.pathItems.length === 1 ? '' : 's'}` : undefined}
                      isDark={C.page !== LIGHT_C.page} text={C.text} muted={C.muted} />
                  </div>
                </>
              );
              return (
                <a href={href} className={FRAMED_CARD} style={{ background: C.card, textDecoration: 'none' }}>
                  {inner}
                </a>
              );
            })()}
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <div className="flex justify-center pt-5">
          <button
            type="button"
            onClick={() => setVisibleCount(count => Math.min(items.length, count + LOAD_MORE_STEP))}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-0.5"
            style={{
              background: C.page === LIGHT_C.page ? '#ffffff' : C.card,
              color: C.text,
              border: `1px solid ${C.cardBorder}`,
            }}
          >
            Load more
            <span className="text-xs font-medium" style={{ color: C.faint }}>
              {remaining}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
