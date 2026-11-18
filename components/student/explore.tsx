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
import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { ArrowRight, Award, BookOpen, Briefcase, Check, Clock, Film, Gift, Globe, GraduationCap, Layers, LayoutGrid, Lock, Loader2, Package, Play, Search, Tag, Target } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { HoverPreviewCard } from '@/components/student/shared';
import { useHoverPreview } from '@/lib/use-hover-preview';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { matchesSearch } from '@/lib/plain-text';
import { useToolIcons } from '@/lib/use-tool-icons';
import type { SectionId } from '@/components/student/nav';
import { groupCatalogue, type ExploreAccess } from '@/lib/explore-filter';
import type { CataloguePathItem } from '@/lib/catalogue-path-items';
import { formatMoney } from '@/lib/books/format';
import { PriceTag } from '@/components/books/store/PriceTag';

type CatalogueType = 'course' | 'learning_path' | 'virtual_experience' | 'certification' | 'book';

interface CatalogueItem {
  id: string;
  type: CatalogueType;
  title: string;
  slug: string | null;
  coverImage: string | null;
  description: string | null;
  category: string | null;
  /** A course's partner ("Offered by ...") or an experience's role. */
  byline?: string | null;
  bylineLogo?: string | null;
  outcomes?: string[];
  level?: string;
  duration?: string;
  tools?: string[];
  examMinutes?: number;
  passmark?: number;
  topics?: string[];
  locked: boolean;
  pathItems?: CataloguePathItem[];
  /** Books only: the price of a locked book, bought on its own. */
  prices?: { currency: string; amount: number; original?: number }[];
  /** Books only: listed in the public store; otherwise the learner's copy is in My Books. */
  inStore?: boolean;
}

const ROW_TITLE: Record<CatalogueType, string> = {
  course:             'Courses',
  learning_path:      'Learning paths',
  virtual_experience: 'Virtual experiences',
  certification:      'Certifications',
  book:               'Digital products',
};

// Image-less fallbacks, mirroring the landing page's per-type gradients so a card with no cover
// still reads as its type rather than as a broken tile.
const TYPE_ORDER: CatalogueType[] = ['course', 'learning_path', 'virtual_experience', 'certification', 'book'];
const INITIAL_VISIBLE = 8;
const LOAD_MORE_STEP = 8;

const TYPE_ICON: Record<CatalogueType, ElementType> = {
  course:             Film,
  learning_path:      Layers,
  virtual_experience: Briefcase,
  certification:      Award,
  book:               Package,
};

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

const resolvedCover = (coverImage: string | null) => resolveCoverUrl(coverImage) || '';
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

/** "GHS 120", or each currency's price when there are several. */
const bookPrice = (item: CatalogueItem) =>
  (item.prices ?? []).map(p => formatMoney(p.amount, p.currency)).join(' / ');

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

  // Path previews widen with the path's contents so their thumbnails lay out in rows.
  const openHover = (item: CatalogueItem, el: HTMLElement) => openPreview(item, el, {
    width: item.type === 'learning_path' ? Math.min(640, Math.max(360, (item.pathItems?.length ?? 0) * 120 + 32)) : 340,
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
              <CataloguePreview item={hover.item} accent={typeColor[hover.item.type]} onOpen={open} C={C} />
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
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg grid place-items-center flex-shrink-0" style={{ background: `${accent}16` }}>
            <Icon className="w-[15px] h-[15px]" style={{ color: accent }} />
          </span>
          <h3 className="text-lg sm:text-xl font-bold leading-tight truncate" style={{ color: C.text }}>
            {title}
          </h3>
        </div>
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: C.faint }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Four across from lg, not three. The hover preview is a fixed 320px, so against a
          three-column card on a wide screen it read as undersized -- a small panel floating over
          a much larger tile. A narrower card puts the two closer in size. */}
      <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 gap-5 pt-4">
        {visibleItems.map(item => (
          <div
            key={item.id}
            onMouseEnter={e => onHover(item, e.currentTarget)}
            onMouseLeave={onHoverLeave}
          >
            {(() => {
              const coverUrl = resolvedCover(item.coverImage);
              const href = directHref(item);
              const inner = (
                <>
                  <div
                    className="relative rounded-xl overflow-hidden w-full aspect-video transition-shadow duration-300 group-hover:shadow-[0_14px_30px_-12px_rgba(2,32,71,0.45)]"
                    style={{ background: coverUrl ? '#0b0b0d' : C.pill }}
                  >
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
                      <span className="absolute left-0 top-3 max-w-[70%] truncate px-2.5 py-1 text-[11px] font-bold"
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

                  <p className="text-[15px] font-bold leading-snug mt-2.5 line-clamp-2" style={{ color: C.text }}>
                    {item.title}
                  </p>
                  {item.locked && item.prices?.length ? (
                    <PriceTag prices={item.prices} className="block text-sm font-bold mt-1" style={{ color: C.text }} />
                  ) : null}
                </>
              );
              return (
                <a
                  href={href}
                  className="group block transition-transform duration-300 hover:-translate-y-1"
                  style={{ textDecoration: 'none' }}
                >
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

function PreviewFact({ C, icon, children }: { C: typeof LIGHT_C; icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ background: C.pill, color: C.text }}>
      {icon && <span className="flex" style={{ color: C.faint }}>{icon}</span>}
      {children}
    </span>
  );
}

function CataloguePreview({ item, accent, onOpen, C }: {
  item: CatalogueItem;
  accent: string;
  onOpen: (item: CatalogueItem) => void;
  C: typeof LIGHT_C;
}) {
  // The preview floats over cards of the same colour, so it needs its own edge and a deep shadow
  // to read as a layer above the page; in dark mode it also sits on a lighter surface.
  const isLight = C.page === LIGHT_C.page;
  const previewShadow = isLight
    ? '0 24px 48px -12px rgba(15,23,42,0.30), 0 8px 20px -8px rgba(15,23,42,0.14)'
    : '0 24px 48px -12px rgba(0,0,0,0.70), 0 8px 20px -8px rgba(0,0,0,0.50)';
  const previewSurface = isLight ? C.card : '#24252e';
  const previewEdge = isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.12)';
  const toolIcon = useToolIcons();
  const desc = (item.description ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (item.type === 'learning_path') {
    const pathItems = item.pathItems ?? [];
    const popupW = Math.min(640, Math.max(360, pathItems.length * 120 + 32));
    return (
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          width: popupW,
          background: previewSurface,
          border: `1px solid ${previewEdge}`,
          boxShadow: previewShadow,
        }}
      >
        <div className="p-4 pb-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: accent, color: 'white' }}>
              Learning Path
            </span>
            {item.locked && <Lock className="w-3.5 h-3.5" style={{ color: C.muted }} />}
          </div>
          <h3 className="text-lg font-bold leading-snug line-clamp-2 mb-1.5" style={{ color: C.text }}>
            {item.title}
          </h3>
          {desc && (
            <p className="text-sm leading-relaxed line-clamp-2 mb-0" style={{ color: C.muted }}>
              {desc}
            </p>
          )}
        </div>

        <div className="p-4">
          {pathItems.length > 0 ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: C.faint }}>
                {pathItems.length} item{pathItems.length !== 1 ? 's' : ''} in this path
              </p>
              <div className="flex flex-wrap gap-2.5">
                {pathItems.map(pathItem => (
                  <div key={pathItem.id} className="flex-shrink-0" style={{ width: 110 }}>
                    {(() => {
                      const coverUrl = resolvedCover(pathItem.coverImage);
                      return (
                        <>
                          <div
                            className="rounded-lg overflow-hidden mb-1.5"
                            style={{ aspectRatio: '16/9', background: coverUrl ? '#0b0b0d' : C.pill }}
                          >
                            {coverUrl ? (
                              <img src={coverUrl} alt={pathItem.title} loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <BookOpen className="w-5 h-5" style={{ color: C.faint }} />
                              </div>
                            )}
                          </div>
                          <p className="text-[11px] font-medium leading-snug line-clamp-2" style={{ color: C.text }}>
                            {pathItem.title}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </>
          ) : (
            desc && <p className="text-sm leading-relaxed line-clamp-3 mb-1" style={{ color: C.muted }}>{desc}</p>
          )}

          {item.locked ? (
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90 mt-4"
              style={{ background: C.cta, color: C.ctaText }}
            >
              <ArrowRight className="w-3.5 h-3.5" />
              View details
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90 mt-4"
              style={{ background: '#00bf63', color: 'white' }}
            >
              <Play className="w-3.5 h-3.5" />
              Start path
            </button>
          )}
        </div>
      </div>
    );
  }

  const coverUrl = resolvedCover(item.coverImage);
  // Laid out like the My Learning card: an inset cover, title and byline, a longer description,
  // then a full-width action.
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: previewSurface,
        border: `1px solid ${previewEdge}`,
        boxShadow: previewShadow,
      }}
    >
      <div className="p-3 pb-0">
      <div className="relative w-full aspect-video overflow-hidden rounded-xl" style={{ background: coverUrl ? '#0b0b0d' : C.pill }}>
        {coverUrl ? (
          <img src={coverUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          // No cover: the tool's logo on soft grey, as the card shows it.
          <div className="w-full h-full flex items-center justify-center">
            {item.category && toolIcon(item.category)
              ? <img src={toolIcon(item.category)!} alt="" className="h-12 w-12 object-contain" />
              : (() => { const Icon = TYPE_ICON[item.type]; return <Icon className="w-9 h-9" style={{ color: C.faint }} />; })()}
          </div>
        )}
        {item.category && (
          <span className="absolute left-0 top-3 max-w-[70%] truncate px-2.5 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
            {item.category}
          </span>
        )}
        {item.locked && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: '#ffffff', color: '#111111' }}>
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
      </div>
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div>
          <h3 className="text-[17px] font-bold leading-snug line-clamp-2" style={{ color: C.text }}>{item.title}</h3>
          {item.byline && (
            <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: C.faint, fontFamily: 'var(--font-lato)' }}>
              {item.bylineLogo && <img src={item.bylineLogo} alt="" className="h-4 w-4 object-contain" />}
              {item.byline}
            </div>
          )}
        </div>

        {desc && (
          <p className="text-[14px] leading-relaxed line-clamp-2" style={{ color: C.muted, fontFamily: 'var(--font-lato)' }}>
            {desc}
          </p>
        )}

        {(item.level || item.duration || item.examMinutes || item.passmark || item.tools?.length || item.topics?.length) && (
          <div className="flex flex-wrap gap-1.5">
            {item.level && <PreviewFact C={C} icon={<GraduationCap className="h-3.5 w-3.5" />}>{item.level} level</PreviewFact>}
            {item.duration && <PreviewFact C={C} icon={<Clock className="h-3.5 w-3.5" />}>{item.duration}</PreviewFact>}
            {item.examMinutes && <PreviewFact C={C} icon={<Clock className="h-3.5 w-3.5" />}>{item.examMinutes} min exam</PreviewFact>}
            {item.passmark && <PreviewFact C={C} icon={<Target className="h-3.5 w-3.5" />}>Pass mark {item.passmark}%</PreviewFact>}
            {item.tools?.map(tool => (
              <PreviewFact key={tool} C={C} icon={toolIcon(tool) ? <img src={toolIcon(tool)!} alt="" className="h-3.5 w-3.5 object-contain" /> : null}>{tool}</PreviewFact>
            ))}
            {item.topics?.map(topic => <PreviewFact key={topic} C={C} icon={<Tag className="h-3.5 w-3.5" />}>{topic}</PreviewFact>)}
          </div>
        )}

        {item.outcomes?.length ? (
          <div>
            <p className="mb-2 text-xs font-bold" style={{ color: C.text }}>
              {item.type === 'certification' ? 'What it covers' : item.type === 'book' ? 'What you will get' : 'What you will learn'}
            </p>
            <ul className="flex flex-col gap-1.5">
              {item.outcomes.map(outcome => (
                <li key={outcome} className="flex gap-2 text-[13px] leading-snug" style={{ color: C.muted, fontFamily: 'var(--font-lato)' }}>
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={3} style={{ color: C.successText }} />
                  <span className="line-clamp-2">{outcome}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {item.locked ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex w-full items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: C.cta, color: C.ctaText }}
          >
            <ArrowRight className="w-3.5 h-3.5" />
            {item.type === 'book' ? `View product${item.prices?.length ? ` - ${bookPrice(item)}` : ''}` : 'View details'}
          </button>
        ) : (() => {
          const label = item.type === 'book' ? (
            <>
              <Package className="w-3.5 h-3.5" />
              Get your copy
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              {item.type === 'virtual_experience' ? 'Start experience' : item.type === 'certification' ? 'Start certification' : 'Start learning'}
            </>
          );
          const cta = 'flex w-full items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl transition-opacity hover:opacity-90';
          const ctaStyle = { background: '#00bf63', color: 'white' };
          const href = directHref(item);
          // A link where one exists, for the same reason the card is one: middle-click, open in a
          // new tab, copy link address, and a screen reader announcing it as a link.
          return href
            ? <a href={href} className={cta} style={{ ...ctaStyle, textDecoration: 'none' }}>{label}</a>
            : <button type="button" onClick={() => onOpen(item)} className={cta} style={ctaStyle}>{label}</button>;
        })()}
      </div>
    </div>
  );
}
