'use client';

// The card My Learning shows for a course, a learning path or a virtual experience. It is the
// Explore card (the same frame, cover, category ribbon and title) with the learner's progress,
// status and one action under it. Clicking anywhere but the action opens the caller's details.

import { useState, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { DARK_C, type LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { FRAMED_CARD } from '@/components/CardMeta';
import { Pill, type Tone } from '@/components/dashboard/subscriptions/ui';

export type LearningCardTag = { label: string; tone: 'red' | 'amber' | 'green' | 'muted' };
/** What the learner has done: Not started, 40% done, Completed, Not passed. */
export type LearningCardStatus = { label: string; tone: Tone };

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

/** The status chips above My Learning: everything, part way, not opened, or done. */
export type LearningStatusFilter = 'all' | 'progress' | 'not_started' | 'done';
export function matchesStatus(filter: LearningStatusFilter, done: boolean, pct: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'done') return done;
  return !done && (filter === 'progress' ? pct > 0 : pct <= 0);
}

/** The status most items share: done, part way, or not opened. */
export function progressStatus(done: boolean, pct: number): LearningCardStatus {
  if (done) return { label: 'Completed', tone: 'good' };
  return pct > 0 ? { label: `${Math.round(pct)}% done`, tone: 'mute' } : { label: 'Not started', tone: 'mute' };
}

/** The progress bar with depth: a sunken track and a lit fill, green once done. Also used by My bootcamp. */
export function DepthBar({ pct, done, C, className }: { pct: number; done: boolean; C: typeof LIGHT_C; className: string }) {
  const fill = done ? C.successText : DARK_C.cta;
  return (
    <div className={`overflow-hidden rounded-full ${className}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      style={{ background: C.pill, boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.12)' }}>
      <div className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${fill} 70%, #ffffff), ${fill})`, boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12)' }} />
    </div>
  );
}

export function LearningCard({
  C, cover, fallbackIcon: FallbackIcon = BookOpen, fallbackLogo, category, tag, title, byline, meta,
  progress, done, status, action, onOpen,
}: {
  C: typeof LIGHT_C;
  cover?: string | null;
  fallbackIcon?: typeof BookOpen;
  /** A tool logo to show on the cover when there is no image. */
  fallbackLogo?: string | null;
  /** On the cover's gold ribbon, as on Explore: the tool or industry. */
  category?: string | null;
  /** On the cover: how long is left before a deadline. */
  tag?: LearningCardTag | null;
  title: string;
  byline?: ReactNode;
  /** One line under the title, such as "12 lessons". */
  meta?: string;
  progress: number;
  done: boolean;
  status: LearningCardStatus;
  action: { label: string; href?: string; onClick?: () => void; quiet?: boolean };
  onOpen: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const showImage = !!cover && !imgErr;
  const actionClass = 'inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-opacity hover:opacity-85';
  const actionStyle = action.quiet
    ? { background: C.card, color: C.text, boxShadow: `inset 0 0 0 1px ${C.divider}` }
    : { background: DARK_C.cta, color: '#ffffff' };

  return (
    <article className={FRAMED_CARD} style={{ background: C.card }} onClick={onOpen}>
      <div className="relative aspect-video w-full overflow-hidden" style={{ background: showImage ? '#0b0b0d' : C.pill }}>
        {showImage ? (
          <img src={resolveCoverUrl(cover)} alt="" loading="lazy" onError={() => setImgErr(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center transition-transform duration-500 group-hover:scale-[1.07]">
            {fallbackLogo
              ? <img src={fallbackLogo} alt="" className="h-12 w-12 object-contain" />
              : <FallbackIcon className="h-8 w-8" style={{ color: C.faint }} />}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'linear-gradient(to top, rgba(1,15,35,0.42), transparent 55%)' }} />
        {category && (
          <span className="absolute left-0 top-3 max-w-[70%] truncate px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
            {category}
          </span>
        )}
        {tag && (
          <span className="absolute right-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: '#ffffff', color: TAG_COLOR[tag.tone] }}>
            {tag.label}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-3 pt-2.5 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-[18px]">
        <div>
          {/* Two lines kept for the title, so the details line up across a row. */}
          <h3 className="min-h-[40px] line-clamp-2 text-[15px] leading-5 font-bold" style={{ color: C.text }}>
            <button type="button" className="text-left" onClick={e => { e.stopPropagation(); onOpen(); }}>{title}</button>
          </h3>
          {byline && <div className="mt-1 text-xs" style={{ color: C.muted }}>{byline}</div>}
          {meta && <p className="mt-1 text-xs" style={{ color: C.muted }}>{meta}</p>}
        </div>

        {/* Progress, status and action sit at the bottom, so they line up across a row. */}
        <div className="mt-auto flex flex-col gap-3.5">
          <DepthBar pct={pct} done={done} C={C} className="h-2.5 w-full" />
          <div className="flex items-center justify-between gap-3" onClick={e => e.stopPropagation()}>
            <Pill tone={status.tone} dot={status.tone === 'good'} C={C}>{status.label}</Pill>
            {action.href
              ? <a href={action.href} target="_blank" rel="noreferrer" className={actionClass} style={actionStyle}>{action.label}</a>
              : <button type="button" onClick={action.onClick} className={actionClass} style={actionStyle}>{action.label}</button>}
          </div>
        </div>
      </div>
    </article>
  );
}
