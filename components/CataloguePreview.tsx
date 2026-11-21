'use client';

/**
 * The hover preview for a catalogue item: an inset cover with its category, title and byline,
 * description, facts (topics, level, duration, exam time, pass mark, tools), what you will learn,
 * and one full-width action. A learning path shows its contents instead.
 *
 * Explore on the student dashboard and the public landing page both render this one component, so
 * a visitor and a signed-in learner see the same preview.
 */
import type { ElementType, ReactNode } from 'react';
import { ArrowRight, Award, BookOpen, Briefcase, Check, Clock, Film, GraduationCap, Layers, Lock, Package, Play, Tag, Target } from 'lucide-react';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { useToolIcons } from '@/lib/use-tool-icons';
import type { CataloguePathItem } from '@/lib/catalogue-path-items';
import { formatMoney } from '@/lib/books/format';

export type CatalogueType = 'course' | 'learning_path' | 'virtual_experience' | 'certification' | 'book';

export interface CatalogueItem {
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

export const TYPE_ICON: Record<CatalogueType, ElementType> = {
  course:             Film,
  learning_path:      Layers,
  virtual_experience: Briefcase,
  certification:      Award,
  book:               Package,
};

export const resolvedCover = (coverImage: string | null) => resolveCoverUrl(coverImage) || '';

/** "GHS 120", or each currency's price when there are several. */
const bookPrice = (item: CatalogueItem) =>
  (item.prices ?? []).map(p => formatMoney(p.amount, p.currency)).join(' / ');

function PreviewFact({ C, icon, children }: { C: typeof LIGHT_C; icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold" style={{ background: C.pill, color: C.text }}>
      {icon && <span className="flex" style={{ color: C.faint }}>{icon}</span>}
      {children}
    </span>
  );
}

export function CataloguePreview({ item, accent, href, onOpen, viewOnly = false, C }: {
  item: CatalogueItem;
  accent: string;
  /** Where the item's page is. */
  href: string;
  /** Locked items, and starting a learning path, go through this rather than a plain link. */
  onOpen: (item: CatalogueItem) => void;
  /** For a visitor who is not signed in: every action reads View details and opens the page. */
  viewOnly?: boolean;
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
            <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: accent, color: 'white' }}>
              Learning Path
            </span>
            {item.locked && <Lock className="w-3.5 h-3.5" style={{ color: C.muted }} />}
          </div>
          <h3 className="text-base leading-6 font-bold line-clamp-2 mb-2" style={{ color: C.text }}>
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
              <div className="flex flex-wrap gap-2">
                {pathItems.map(pathItem => (
                  <div key={pathItem.id} className="flex-shrink-0" style={{ width: 110 }}>
                    {(() => {
                      const coverUrl = resolvedCover(pathItem.coverImage);
                      return (
                        <>
                          <div
                            className="rounded-lg overflow-hidden mb-2"
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

          {item.locked || viewOnly ? (
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-3 rounded-xl transition-opacity hover:opacity-90 mt-4"
              style={{ background: C.cta, color: C.ctaText }}
            >
              <ArrowRight className="w-3.5 h-3.5" />
              View details
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-3 rounded-xl transition-opacity hover:opacity-90 mt-4"
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
          <span className="absolute left-0 top-3 max-w-[70%] truncate px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
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
          <h3 className="text-base font-bold leading-snug line-clamp-2" style={{ color: C.text }}>{item.title}</h3>
          {item.byline && (
            <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: C.faint, fontFamily: 'var(--font-lato)' }}>
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

        {/* Boolean, not the bare chain: with empty lists it ends on a length of 0, which React prints. */}
        {Boolean(item.level || item.duration || item.examMinutes || item.passmark || item.tools?.length || item.topics?.length) && (
          <div className="flex flex-wrap gap-2">
            {/* Tags (topics) first, then the level, then the rest. */}
            {item.topics?.map(topic => <PreviewFact key={topic} C={C} icon={<Tag className="h-3.5 w-3.5" />}>{topic}</PreviewFact>)}
            {item.level && <PreviewFact C={C} icon={<GraduationCap className="h-3.5 w-3.5" />}>{item.level} level</PreviewFact>}
            {item.duration && <PreviewFact C={C} icon={<Clock className="h-3.5 w-3.5" />}>{item.duration}</PreviewFact>}
            {item.examMinutes && <PreviewFact C={C} icon={<Clock className="h-3.5 w-3.5" />}>{item.examMinutes} min exam</PreviewFact>}
            {item.passmark && <PreviewFact C={C} icon={<Target className="h-3.5 w-3.5" />}>Pass mark {item.passmark}%</PreviewFact>}
            {item.tools?.map(tool => (
              <PreviewFact key={tool} C={C} icon={toolIcon(tool) ? <img src={toolIcon(tool)!} alt="" className="h-3.5 w-3.5 object-contain" /> : null}>{tool}</PreviewFact>
            ))}
          </div>
        )}

        {item.outcomes?.length ? (
          <div>
            <p className="mb-2 text-xs font-bold" style={{ color: C.text }}>
              {item.type === 'certification' ? 'What it covers' : item.type === 'book' ? 'What you will get' : 'What you will learn'}
            </p>
            <ul className="flex flex-col gap-2">
              {item.outcomes.map(outcome => (
                <li key={outcome} className="flex gap-2 text-sm leading-snug" style={{ color: C.muted, fontFamily: 'var(--font-lato)' }}>
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={3} style={{ color: C.successText }} />
                  <span className="line-clamp-2">{outcome}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {viewOnly && !item.locked ? (
          <a href={href}
            className="flex w-full items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: C.cta, color: C.ctaText, textDecoration: 'none' }}>
            <ArrowRight className="w-3.5 h-3.5" />
            View details
          </a>
        ) : item.locked ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex w-full items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl transition-opacity hover:opacity-90"
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
          const cta = 'flex w-full items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl transition-opacity hover:opacity-90';
          const ctaStyle = { background: '#00bf63', color: 'white' };
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
