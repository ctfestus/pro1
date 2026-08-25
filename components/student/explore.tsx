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
import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { ArrowRight, Award, BookOpen, Briefcase, Film, Layers, Lock, Loader2, Play } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { HoverPreviewCard } from '@/components/student/shared';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { SectionId } from '@/components/student/nav';

type CatalogueType = 'course' | 'learning_path' | 'virtual_experience' | 'certification';

interface CatalogueItem {
  id: string;
  type: CatalogueType;
  title: string;
  slug: string | null;
  coverImage: string | null;
  description: string | null;
  category: string | null;
  locked: boolean;
  pathItems?: CataloguePathItem[];
}

interface CataloguePathItem {
  id: string;
  type: 'course' | 'virtual_experience' | 'certification';
  title: string;
  slug: string | null;
  coverImage: string | null;
}

const TYPE_LABEL: Record<CatalogueType, string> = {
  course:             'Course',
  learning_path:      'Learning Path',
  virtual_experience: 'Virtual Experience',
  certification:      'Certification',
};

const ROW_TITLE: Record<CatalogueType, string> = {
  course:             'Courses',
  learning_path:      'Learning Paths',
  virtual_experience: 'Virtual Experiences',
  certification:      'Certifications',
};

// Image-less fallbacks, mirroring the landing page's per-type gradients so a card with no cover
// still reads as its type rather than as a broken tile.
const TYPE_GRAD: Record<CatalogueType, string> = {
  course:             'linear-gradient(135deg,#1E3A8A 0%,#3B82F6 100%)',
  learning_path:      'linear-gradient(135deg,#92400E 0%,#F59E0B 100%)',
  virtual_experience: 'linear-gradient(135deg,#064E3B 0%,#10B981 100%)',
  certification:      'linear-gradient(135deg,#155E75 0%,#06B6D4 100%)',
};

// Where unlocked learning cards send the student. Free courses/certifications open their public
// URL directly, so Explore is a real catalogue entry point instead of another dashboard detour.
const TYPE_SECTION: Record<CatalogueType, SectionId> = {
  course:             'courses',
  learning_path:      'learning_paths',
  virtual_experience: 'virtual_experiences',
  certification:      'certifications',
};

const TYPE_ORDER: CatalogueType[] = ['course', 'learning_path', 'virtual_experience', 'certification'];
const INITIAL_VISIBLE = 8;
const LOAD_MORE_STEP = 8;

const TYPE_ICON: Record<CatalogueType, ElementType> = {
  course:             Film,
  learning_path:      Layers,
  virtual_experience: Briefcase,
  certification:      Award,
};

const FILTERS: { value: 'all' | CatalogueType; label: string }[] = [
  { value: 'all',                label: 'All content' },
  { value: 'course',             label: 'Courses' },
  { value: 'learning_path',      label: 'Learning Paths' },
  { value: 'virtual_experience', label: 'Virtual Experiences' },
  { value: 'certification',      label: 'Certifications' },
];

type HoverState = {
  item: CatalogueItem;
  left: number; top: number; originX: number; originY: number;
};

const CATEGORY_COLORS = [
  '#bfdbfe',
  '#bbf7d0',
  '#fed7aa',
  '#bae6fd',
  '#fde68a',
  '#fbcfe8',
  '#ddd6fe',
  '#cbd5e1',
];

function categoryColor(category: string) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

function CategoryPill({ category }: { category: string }) {
  const color = categoryColor(category.toLowerCase());
  return (
    <span
      className="inline-flex max-w-full items-center rounded-md px-2.5 py-1 text-[11px] font-bold leading-none"
      style={{ background: color, color: '#101828' }}
    >
      <span className="truncate">{category}</span>
    </span>
  );
}

const resolvedCover = (coverImage: string | null) => resolveCoverUrl(coverImage) || '';

export function ExploreSection({ C, onNavigate }: {
  C: typeof LIGHT_C;
  onNavigate?: (section: SectionId) => void;
}) {
  const { primaryColor, accentColor } = useTenant();
  const typeColor: Record<CatalogueType, string> = {
    course:             primaryColor || '#0056D2',
    learning_path:      accentColor  || '#FF9933',
    virtual_experience: '#00BF63',
    certification:      '#0891B2',
  };

  const [items,   setItems]   = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [filter,  setFilter]  = useState<'all' | CatalogueType>('all');
  const [hover,   setHover]   = useState<HoverState | null>(null);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHover(null), 120);
  }, [cancelClose]);
  useEffect(() => () => cancelClose(), [cancelClose]);

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

  // Unlocked first: what a student can actually start matters more than what they cannot.
  const grouped = useMemo(() => {
    const out = new Map<CatalogueType, CatalogueItem[]>();
    for (const t of TYPE_ORDER) {
      if (filter !== 'all' && filter !== t) continue;
      const list = items.filter(i => i.type === t)
        .sort((a, b) => Number(a.locked) - Number(b.locked));
      if (list.length) out.set(t, list);
    }
    return out;
  }, [items, filter]);

  const open = (item: CatalogueItem) => {
    if (item.locked) return;
    if (item.type === 'course' || item.type === 'certification') {
      window.location.href = `/${item.slug || item.id}`;
      return;
    }
    onNavigate?.(TYPE_SECTION[item.type]);
  };

  // Desktop only. The popover is a hover affordance, and on touch there is no hover to close it.
  const openHover = (item: CatalogueItem, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = item.type === 'learning_path'
      ? Math.min(640, Math.max(360, (item.pathItems?.length ?? 0) * 120 + 32))
      : 320;
    const H = 500;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    setHover({
      item, left, top,
      originX: Math.max(0, Math.min(r.left + r.width / 2 - left, W)),
      originY: Math.max(0, Math.min(r.top + r.height / 2 - top, H)),
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm" style={{ color: C.muted }}>
          Everything on the platform. Locked items are not part of your access yet.
        </p>

        {/* Buttons rather than a select: the options are few, they fit, and a filter you can see is
            faster than one you have to open. Wraps on a narrow screen instead of scrolling. */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by content type">
          {FILTERS.map(f => {
            const active = filter === f.value;
            const inactiveStyle = C.page === LIGHT_C.page
              ? { background: '#ffffff', color: C.muted, border: `1px solid ${C.cardBorder}` }
              : { background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` };
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => { setFilter(f.value); setHover(null); }}
                className="px-3.5 py-2 rounded-full text-sm font-semibold transition-all"
                style={active
                  ? { background: primaryColor || '#0056D2', color: '#ffffff' }
                  : inactiveStyle}
              >
                {f.label}
              </button>
            );
          })}
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
          Nothing published in this category yet.
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
              width={hover.item.type === 'learning_path'
                ? Math.min(640, Math.max(360, (hover.item.pathItems?.length ?? 0) * 120 + 32))
                : 320}
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

      <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pt-4">
        {visibleItems.map(item => (
          <div
            key={item.id}
            onMouseEnter={e => onHover(item, e.currentTarget)}
            onMouseLeave={onHoverLeave}
          >
            {(() => {
              const coverUrl = resolvedCover(item.coverImage);
              return (
            <div
              onClick={() => onOpen(item)}
              className="group transition-transform duration-300 hover:-translate-y-1"
              style={{ cursor: item.locked ? 'not-allowed' : 'pointer' }}
            >
              <div
                className="relative rounded-xl overflow-hidden w-full aspect-video transition-shadow duration-300 group-hover:shadow-[0_14px_30px_-12px_rgba(2,32,71,0.45)]"
                style={{ background: coverUrl ? '#0b0b0d' : 'transparent' }}
              >
                {coverUrl
                  ? <img src={coverUrl} alt={item.title} loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
                  : <div className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-[1.07]"
                      style={{ background: TYPE_GRAD[type] }}>
                      <BookOpen className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.7)' }} />
                    </div>
                }

                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, rgba(1,15,35,0.42), transparent 55%)' }} />

                {item.locked && (
                  <span
                    aria-label="Locked"
                    className="absolute top-2 left-2 w-7 h-7 rounded-full grid place-items-center"
                    style={{ background: 'rgba(0,0,0,0.62)', color: '#ffffff', backdropFilter: 'blur(8px)' }}>
                    <Lock className="w-3.5 h-3.5" />
                  </span>
                )}

                <div className="absolute bottom-2 right-2 w-8 h-8 rounded-full grid place-items-center opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 shadow-md pointer-events-none"
                  style={{ background: 'white', color: '#101828' }}>
                  {item.locked ? <Lock className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </div>
              </div>

              <p className="text-[15px] font-bold leading-snug mt-2.5 line-clamp-2" style={{ color: C.text }}>
                {item.title}
              </p>
              {item.category && (
                <div className="mt-2">
                  <CategoryPill category={item.category} />
                </div>
              )}
            </div>
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

function CataloguePreview({ item, accent, onOpen, C }: {
  item: CatalogueItem;
  accent: string;
  onOpen: (item: CatalogueItem) => void;
  C: typeof LIGHT_C;
}) {
  const previewShadow = '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)';
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
          background: C.card,
          border: `1px solid ${C.cardBorder}`,
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
            <div className="mt-4 rounded-xl px-4 py-3 text-sm leading-relaxed" style={{ background: C.pill, color: C.muted }}>
              <span className="flex items-center gap-2 text-xs">
                <Lock className="w-3.5 h-3.5" />
                Not part of your access yet.
              </span>
            </div>
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

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: C.card,
        border: `1px solid ${C.cardBorder}`,
        boxShadow: previewShadow,
      }}
    >
      {(() => {
        const coverUrl = resolvedCover(item.coverImage);
        return (
      <div className="relative w-full aspect-video" style={{ background: coverUrl ? '#0b0b0d' : 'transparent' }}>
        {coverUrl ? (
          <img src={coverUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: TYPE_GRAD[item.type] }}>
            <BookOpen className="w-10 h-10" style={{ color: 'rgba(255,255,255,0.7)' }} />
          </div>
        )}
        <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: accent, color: 'white' }}>
          {TYPE_LABEL[item.type]}
        </span>
        {item.locked && (
          <span className="absolute top-2 right-2 w-7 h-7 rounded-full grid place-items-center" style={{ background: 'rgba(0,0,0,0.62)', color: '#ffffff', backdropFilter: 'blur(8px)' }}>
            <Lock className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
        );
      })()}

      <div className="p-5">
        <p className="text-xs mb-1" style={{ color: C.faint }}>{TYPE_LABEL[item.type]}</p>
        <h3 className="text-lg font-bold leading-snug mb-2 line-clamp-2" style={{ color: C.text }}>{item.title}</h3>

        {desc && (
          <p className="text-sm leading-relaxed line-clamp-3 mb-3" style={{ color: C.muted }}>
            {desc}
          </p>
        )}
        {item.category && (
          <div className="mb-3">
            <CategoryPill category={item.category} />
          </div>
        )}

        {item.locked ? (
          <div className="rounded-xl px-4 py-3 text-sm leading-relaxed" style={{ background: C.pill, color: C.muted }}>
            <span className="flex items-center gap-2 text-xs">
              <Lock className="w-3.5 h-3.5" />
              Not part of your access yet.
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: '#00bf63', color: 'white' }}
          >
            <Play className="w-3.5 h-3.5" />
            {item.type === 'virtual_experience' ? 'Start experience' : item.type === 'certification' ? 'Start certification' : 'Start learning'}
          </button>
        )}
      </div>
    </div>
  );
}
