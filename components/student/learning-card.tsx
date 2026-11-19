'use client';

// The card My Learning shows for a course, a learning path or a virtual experience: the cover
// edge to edge, then the title, a short description, progress, one figure and one action.
// Clicking anywhere but the action opens the caller's details.

import { useState, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import type { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';

export type LearningCardTag = { label: string; tone: 'red' | 'amber' | 'green' | 'muted' };

const TAG_COLOR: Record<LearningCardTag['tone'], string> = {
  red: '#D93025', amber: '#b45309', green: '#16a34a', muted: '#555555',
};

/** Days-left label for a deadline, or null when there is none or the item is done. */
export function deadlineTag(deadline: Date | null | undefined, done: boolean): LearningCardTag | null {
  if (!deadline || done) return null;
  const days = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: 'Overdue', tone: 'red' };
  if (days === 0) return { label: 'Due today', tone: 'amber' };
  return { label: `${days} day${days === 1 ? '' : 's'} left`, tone: days <= 3 ? 'amber' : 'muted' };
}

export function LearningCard({
  C, cover, fallbackIcon: FallbackIcon = BookOpen, fallbackLogo, tag, title, byline, description,
  progress, done, figure, figureLabel, chip, action, onOpen,
}: {
  C: typeof LIGHT_C;
  cover?: string | null;
  fallbackIcon?: typeof BookOpen;
  /** A tool logo to show on the cover when there is no image. */
  fallbackLogo?: string | null;
  tag?: LearningCardTag | null;
  title: string;
  byline?: ReactNode;
  description?: string;
  progress: number;
  done: boolean;
  figure: ReactNode;
  figureLabel: string;
  chip?: { label: string; icon?: string | null } | null;
  action: { label: string; href?: string; onClick?: () => void; quiet?: boolean };
  onOpen: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const fill = done ? C.successText : C.cta;
  const showImage = !!cover && !imgErr;
  const actionClass = 'flex w-full items-center justify-center rounded-xl py-3 text-sm font-bold transition-opacity hover:opacity-85';
  const actionStyle = action.quiet ? { background: C.pill, color: C.text } : { background: C.cta, color: C.ctaText };

  return (
    <article
      className="group flex h-full cursor-pointer flex-col rounded-2xl transition-all hover:-translate-y-0.5 hover:shadow-lg"
      style={{ background: C.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 6px 20px rgba(15,23,42,0.06)' }}
      onClick={onOpen}
    >
      <div className="p-3 pb-0">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl" style={{ background: showImage ? '#0b0b0d' : C.pill }}>
        {showImage ? (
          <img src={resolveCoverUrl(cover)} alt="" loading="lazy" onError={() => setImgErr(true)}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {fallbackLogo
              ? <img src={fallbackLogo} alt="" className="h-14 w-14 object-contain" />
              : <FallbackIcon className="h-10 w-10" style={{ color: C.faint }} />}
          </div>
        )}
        {tag && (
          <span className="absolute left-3 top-3 rounded-md px-2 py-0.5 text-xs font-bold"
            style={{ background: '#ffffff', color: TAG_COLOR[tag.tone] }}>
            {tag.label}
          </span>
        )}
      </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div>
          <h3 className="line-clamp-2 text-base leading-6 font-bold" style={{ color: C.text }}>
            <button type="button" className="text-left" onClick={e => { e.stopPropagation(); onOpen(); }}>{title}</button>
          </h3>
          {byline && <div className="mt-1 text-xs" style={{ color: C.faint, fontFamily: 'var(--font-lato)' }}>{byline}</div>}
        </div>
        {description && (
          <p className="line-clamp-4 text-[14px] leading-relaxed" style={{ color: C.muted, fontFamily: 'var(--font-lato)' }}>{description}</p>
        )}

        {/* Progress, figure and action sit at the bottom, so they line up across a row. */}
        <div className="mt-auto flex flex-col gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold" style={{ color: C.text }}>Progress</p>
          <div className="flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full"
              style={{ background: C.pill, boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.12)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${fill} 70%, #ffffff), ${fill})`, boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12)' }} />
            </div>
            <span className="text-xs font-bold tabular-nums" style={{ color: C.text }}>{pct}%</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[22px] leading-7 font-bold tabular-nums" style={{ color: C.text }}>{figure}</p>
            <p className="text-xs" style={{ color: C.muted }}>{figureLabel}</p>
          </div>
          {chip && (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}>
              {chip.icon && <img src={chip.icon} alt="" className="h-3.5 w-3.5 object-contain" />}
              {chip.label}
            </span>
          )}
        </div>

        <div className="pt-1" onClick={e => e.stopPropagation()}>
          {action.href
            ? <a href={action.href} target="_blank" rel="noreferrer" className={`${actionClass} dashboard-cta`} style={actionStyle}>{action.label}</a>
            : <button type="button" onClick={action.onClick} className={actionClass} style={actionStyle}>{action.label}</button>}
        </div>
        </div>
      </div>
    </article>
  );
}
