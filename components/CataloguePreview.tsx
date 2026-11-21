'use client';

/**
 * The hover preview for a catalogue item: an inset cover with its category, title and byline,
 * description, facts (topics, level, duration, exam time, pass mark, tools), what a certification
 * covers or a book gives, and one full-width action. A learning path shows its contents instead.
 *
 * Explore on the student dashboard and the public landing page both render this one component, so
 * a visitor and a signed-in learner see the same preview.
 */
import type { ElementType, ReactNode } from 'react';
import { ArrowRight, Award, Briefcase, Check, Clock, Film, GraduationCap, Layers, Lock, Package, Play, Tag, Target } from 'lucide-react';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { useToolIcons } from '@/lib/use-tool-icons';
import type { CataloguePathItem } from '@/lib/catalogue-path-items';
import { formatMoney } from '@/lib/books/format';
import { ToolLogos } from '@/components/CardMeta';

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
  /** A learning path's skills (path editor), shown as its tags. */
  skills?: string[];
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

/** A level as three bars filled up to it, as the landing page's course cards show it. */
const LEVEL_BARS: Record<string, number> = { Beginner: 1, Intermediate: 2, Advanced: 3 };

export function LevelBars({ level, color, track }: { level: string; color: string; track: string }) {
  const filled = LEVEL_BARS[level] ?? 0;
  return (
    <span aria-hidden="true" className="inline-flex items-end gap-[2px] h-[11px]">
      {[5, 8, 11].map((h, i) => (
        <i key={h} className="block w-[3px] rounded-[1px]" style={{ height: h, background: i < filled ? color : track }} />
      ))}
    </span>
  );
}

function PreviewFact({ C, icon, children }: { C: typeof LIGHT_C; icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold" style={{ background: C.pill, color: C.text }}>
      {icon && <span className="flex" style={{ color: C.faint }}>{icon}</span>}
      {children}
    </span>
  );
}

export function CataloguePreview({ item, accent, href, onOpen, viewOnly = false, font, compact = false, C }: {
  item: CatalogueItem;
  accent: string;
  /** Where the item's page is. */
  href: string;
  /** Locked items, and starting a learning path, go through this rather than a plain link. */
  onOpen: (item: CatalogueItem) => void;
  /** For a visitor who is not signed in: every action reads View details and opens the page. */
  viewOnly?: boolean;
  /**
   * The page's font for every line of the preview. The landing page passes its Site settings font:
   * the preview renders outside the page (a portal on body), so it would otherwise fall back to the
   * app's own fonts. Without it, the page's font as Explore uses it, description included.
   */
  font?: string;
  /**
   * The landing page's preview: smaller type and padding, plain tags, and the level with the
   * card's bars on its own line with the tool on the right, matching the course card.
   */
  compact?: boolean;
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
    // A path's preview, the width of the others: cover, title, description, skills (six,
    // then "+N"), the item count with the tools, the first four items as a numbered list, action.
    const pathItems = item.pathItems ?? [];
    const skills = item.skills ?? [];
    const coverUrl = resolvedCover(item.coverImage);
    const chip = (key: string, label: string) => (
      <span key={key} className="inline-flex items-center h-[22px] px-2 rounded-md text-[12px] font-medium" style={{ background: C.pill, color: C.muted }}>{label}</span>
    );
    return (
      <div className="rounded-xl overflow-hidden" style={{ fontFamily: font, background: previewSurface, border: `1px solid ${previewEdge}`, boxShadow: previewShadow }}>
        <div className="p-3 pb-0">
          <div className="relative w-full aspect-video overflow-hidden rounded-lg" style={{ background: coverUrl ? '#0b0b0d' : C.pill }}>
            {coverUrl
              ? <img src={coverUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center"><Layers className="w-9 h-9" style={{ color: C.faint }} /></div>}
            <span className="absolute left-0 top-3 px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>Learning path</span>
            {item.locked && (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: '#ffffff', color: '#111111' }}>
                <Lock className="h-3 w-3" /> Locked
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <h3 className="text-[15px] leading-5 font-bold line-clamp-2" style={{ color: C.text }}>{item.title}</h3>
          {desc && <p className="text-[13px] leading-5 line-clamp-2" style={{ color: C.muted }}>{desc}</p>}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skills.slice(0, 6).map(skill => chip(skill, skill))}
              {skills.length > 6 && chip('more', `+${skills.length - 6}`)}
            </div>
          )}
          {(pathItems.length > 0 || (item.tools?.length ?? 0) > 0) && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] leading-[18px]" style={{ color: C.muted }}>
                {pathItems.length > 0 ? `${pathItems.length} learning item${pathItems.length === 1 ? '' : 's'}` : ''}
              </span>
              {(item.tools?.length ?? 0) > 0 && <ToolLogos tools={item.tools!} muted={C.muted} />}
            </div>
          )}
          {pathItems.length > 0 && (
            <ol className="flex flex-col gap-1.5 text-[13px] leading-[18px]" style={{ color: C.text }}>
              {pathItems.slice(0, 4).map((pathItem, i) => (
                <li key={pathItem.id} className="flex gap-2">
                  <span className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ background: C.pill, color: C.muted }}>{i + 1}</span>
                  <span className="line-clamp-1">{pathItem.title}</span>
                </li>
              ))}
              {pathItems.length > 4 && <li className="pl-[26px]" style={{ color: C.muted }}>and {pathItems.length - 4} more</li>}
            </ol>
          )}
          {item.locked ? (
            <button type="button" onClick={() => onOpen(item)}
              className="flex w-full items-center justify-center gap-2 text-[13px] font-bold py-2.5 rounded-xl transition-opacity hover:opacity-90"
              style={{ background: C.cta, color: C.ctaText }}>
              <ArrowRight className="w-3.5 h-3.5" /> View details
            </button>
          ) : (
            <button type="button" onClick={() => onOpen(item)}
              className="flex w-full items-center justify-center gap-2 text-[13px] font-bold py-2.5 rounded-xl transition-opacity hover:opacity-90"
              style={{ background: '#00bf63', color: 'white' }}>
              <Play className="w-3.5 h-3.5" /> Start path
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
      className={`${compact ? 'rounded-xl' : 'rounded-2xl'} overflow-hidden`}
      style={{
        fontFamily: font,
        background: previewSurface,
        border: `1px solid ${previewEdge}`,
        boxShadow: previewShadow,
      }}
    >
      <div className="p-3 pb-0">
      <div className={`relative w-full aspect-video overflow-hidden ${compact ? 'rounded-lg' : 'rounded-xl'}`} style={{ background: coverUrl ? '#0b0b0d' : C.pill }}>
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

      <div className={compact ? 'flex flex-col gap-3 p-5' : 'flex flex-col gap-4 p-6'}>
        <div>
          <h3 className={`${compact ? 'text-[15px] leading-5' : 'text-base leading-snug'} font-bold line-clamp-2`} style={{ color: C.text }}>{item.title}</h3>
          {item.byline && (
            <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: C.faint }}>
              {item.bylineLogo && <img src={item.bylineLogo} alt="" className="h-4 w-4 object-contain" />}
              {item.byline}
            </div>
          )}
        </div>

        {desc && (
          <p className={`${compact ? 'text-[13px] leading-5' : 'text-[14px] leading-relaxed'} line-clamp-2`} style={{ color: C.muted }}>
            {desc}
          </p>
        )}

        {compact ? (
          <>
            {/* Every tag, plain, as on the card. */}
            {item.topics?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {item.topics.map(topic => (
                  <span key={topic} className="inline-flex items-center h-[22px] px-2 rounded-md text-[12px] font-medium" style={{ background: C.pill, color: C.muted }}>{topic}</span>
                ))}
              </div>
            ) : null}
            {/* The level with the card's bars on the left, the tool on the right, as on the card. */}
            {(item.level || item.tools?.length) ? (
              <div className="flex items-center justify-between gap-2">
                {item.level ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] leading-[18px]" style={{ color: C.muted }}>
                    <LevelBars level={item.level} color={C.text} track={C.cardBorder === 'transparent' ? 'rgba(255,255,255,0.25)' : '#D5DAE1'} />
                    {item.level}
                  </span>
                ) : <span />}
                <span className="flex flex-wrap justify-end gap-1.5">
                  {/* The logo alone, as on the card; the name only when the tool has no logo. */}
                  {item.tools?.map(tool => toolIcon(tool)
                    ? <img key={tool} src={toolIcon(tool)!} alt={tool} title={tool} className="h-4 w-auto max-w-[60px] object-contain" />
                    : <span key={tool} className="text-[12px] font-semibold" style={{ color: C.text }}>{tool}</span>)}
                </span>
              </div>
            ) : null}
            {/* Experiences and certifications keep their other facts. */}
            {Boolean(item.duration || item.examMinutes || item.passmark) && (
              <div className="flex flex-wrap gap-2">
                {item.duration && <PreviewFact C={C} icon={<Clock className="h-3.5 w-3.5" />}>{item.duration}</PreviewFact>}
                {item.examMinutes && <PreviewFact C={C} icon={<Clock className="h-3.5 w-3.5" />}>{item.examMinutes} min exam</PreviewFact>}
                {item.passmark && <PreviewFact C={C} icon={<Target className="h-3.5 w-3.5" />}>Pass mark {item.passmark}%</PreviewFact>}
              </div>
            )}
          </>
        ) : null}

        {/* Boolean, not the bare chain: with empty lists it ends on a length of 0, which React prints. */}
        {!compact && Boolean(item.level || item.duration || item.examMinutes || item.passmark || item.tools?.length || item.topics?.length) && (
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

        {/* Only a certification and a book list theirs; a course's or experience's outcomes are left out. */}
        {item.outcomes?.length && (item.type === 'certification' || item.type === 'book') ? (
          <div>
            <p className="mb-2 text-xs font-bold" style={{ color: C.text }}>
              {item.type === 'certification' ? 'What it covers' : 'What you will get'}
            </p>
            <ul className="flex flex-col gap-2">
              {item.outcomes.map(outcome => (
                <li key={outcome} className="flex gap-2 text-sm leading-snug" style={{ color: C.muted }}>
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={3} style={{ color: C.successText }} />
                  <span className="line-clamp-2">{outcome}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {viewOnly && !item.locked ? (
          <a href={href}
            className={`flex w-full items-center justify-center gap-2 font-bold rounded-xl transition-opacity hover:opacity-90 ${compact ? 'text-[13px] py-2.5' : 'text-sm py-3'}`}
            style={{ background: C.cta, color: C.ctaText, textDecoration: 'none' }}>
            <ArrowRight className="w-3.5 h-3.5" />
            View details
          </a>
        ) : item.locked ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className={`flex w-full items-center justify-center gap-2 font-bold rounded-xl transition-opacity hover:opacity-90 ${compact ? 'text-[13px] py-2.5' : 'text-sm py-3'}`}
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
          const cta = `flex w-full items-center justify-center gap-2 font-bold rounded-xl transition-opacity hover:opacity-90 ${compact ? 'text-[13px] py-2.5' : 'text-sm py-3'}`;
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
