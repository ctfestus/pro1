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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { ArrowRight, BookOpen, ChevronLeft, ChevronRight, Lock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { HoverPreviewCard } from '@/components/student/shared';
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

// Where an unlocked card sends the student. Deep links into players are deliberately avoided --
// each section already knows how to open its own content, deadlines and attempts.
const TYPE_SECTION: Record<CatalogueType, SectionId> = {
  course:             'courses',
  learning_path:      'learning_paths',
  virtual_experience: 'virtual_experiences',
  certification:      'certifications',
};

const TYPE_ORDER: CatalogueType[] = ['course', 'learning_path', 'virtual_experience', 'certification'];

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
    onNavigate?.(TYPE_SECTION[item.type]);
  };

  // Desktop only. The popover is a hover affordance, and on touch there is no hover to close it.
  const openHover = (item: CatalogueItem, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = 320, H = 420;
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
      <style>{`
        @keyframes explore-sheen { 0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
          35% { opacity: 0.55; } 100% { transform: translateX(320%) skewX(-18deg); opacity: 0; } }
        .explore-shine-host { position: relative; }
        .explore-card-shine { position: absolute; top: 0; bottom: 0; left: 0; width: 45%; opacity: 0;
          pointer-events: none; z-index: 15;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); }
        .explore-shine-host:hover .explore-card-shine { animation: explore-sheen 0.9s ease; }
        @media (prefers-reduced-motion: reduce) { .explore-card-shine { display: none; } }
      `}</style>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold" style={{ color: C.text }}>Explore</h2>
          <p className="text-sm" style={{ color: C.muted }}>
            Everything on the platform. Locked items are not part of your access yet.
          </p>
        </div>

        <select
          value={filter}
          onChange={e => { setFilter(e.target.value as 'all' | CatalogueType); setHover(null); }}
          aria-label="Filter by content type"
          className="px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
        >
          {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
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
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <CataloguePreview item={hover.item} accent={typeColor[hover.item.type]} onOpen={open} />
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 380, behavior: 'smooth' });

  const arrowBtn = (dir: number, label: string) => (
    <button
      type="button"
      onClick={() => scrollByCards(dir)}
      aria-label={label}
      className="w-9 h-9 rounded-full grid place-items-center transition-all duration-200 hover:scale-105 active:scale-95"
      style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}
    >
      {dir < 0 ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
    </button>
  );

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: accent }} />
          <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>
            {title}
          </h3>
        </div>
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          {arrowBtn(-1, `Scroll ${title} left`)}
          {arrowBtn(1, `Scroll ${title} right`)}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-nowrap gap-4 overflow-x-auto pt-4 pb-2 snap-x"
        style={{
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          WebkitMaskImage: 'linear-gradient(90deg, #000 94%, transparent)',
          maskImage: 'linear-gradient(90deg, #000 94%, transparent)',
        }}
      >
        {items.map(item => (
          <div
            key={item.id}
            className="flex-shrink-0 w-[220px] sm:w-[260px] snap-start"
            onMouseEnter={e => onHover(item, e.currentTarget)}
            onMouseLeave={onHoverLeave}
          >
            <div
              onClick={() => onOpen(item)}
              className="group transition-transform duration-300 hover:-translate-y-1"
              style={{ cursor: item.locked ? 'default' : 'pointer' }}
            >
              <div
                className="explore-shine-host relative rounded-xl overflow-hidden w-full aspect-video transition-shadow duration-300 group-hover:shadow-[0_14px_30px_-12px_rgba(2,32,71,0.45)]"
                style={{ background: item.coverImage ? '#0b0b0d' : 'transparent' }}
              >
                {item.coverImage
                  ? <img src={item.coverImage} alt={item.title} loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                      style={{ filter: item.locked ? 'grayscale(0.8)' : 'none' }} />
                  : <div className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-[1.07]"
                      style={{ background: TYPE_GRAD[type], filter: item.locked ? 'grayscale(0.8)' : 'none' }}>
                      <BookOpen className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.7)' }} />
                    </div>
                }

                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, rgba(1,15,35,0.42), transparent 55%)' }} />

                {item.locked && (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] px-2 py-1 rounded-md"
                    style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)' }}>
                    <Lock className="w-3 h-3" /> Locked
                  </span>
                )}

                <div className="absolute bottom-2 right-2 w-8 h-8 rounded-full grid place-items-center opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 shadow-md pointer-events-none"
                  style={{ background: 'white', color: '#101828' }}>
                  {item.locked ? <Lock className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </div>

                <span className="explore-card-shine" />
              </div>

              <p className="text-[15px] font-bold leading-snug mt-2.5 line-clamp-2" style={{ color: C.text }}>
                {item.title}
              </p>
              {item.category && (
                <p className="text-[11px] mt-1" style={{ color: C.muted }}>{item.category}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CataloguePreview({ item, accent, onOpen }: {
  item: CatalogueItem;
  accent: string;
  onOpen: (item: CatalogueItem) => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-1 rounded-md"
          style={{ background: `${accent}1a`, color: accent }}>
          {TYPE_LABEL[item.type]}
        </span>
        {item.locked && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color: '#6E7383' }}>
            <Lock className="w-3 h-3" /> Locked
          </span>
        )}
      </div>

      <h4 className="text-base font-bold leading-snug" style={{ color: '#1C1D1F' }}>{item.title}</h4>

      {item.description && (
        <p className="text-[13px] leading-relaxed line-clamp-4" style={{ color: '#6E7383' }}>
          {item.description}
        </p>
      )}

      {item.locked ? (
        <p className="text-[12px] leading-relaxed" style={{ color: '#6E7383' }}>
          Not part of your access yet. Talk to your Learning Advisor about opening it up.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: accent, color: '#ffffff' }}
        >
          Go to {TYPE_LABEL[item.type]} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
