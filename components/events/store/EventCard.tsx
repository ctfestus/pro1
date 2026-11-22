import Link from 'next/link';
import { CalendarDays, MapPin, Video } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { FRAMED_CARD } from '@/components/CardMeta';
import { dateParts, displayDate, displayTime, recurrenceLabel, type PublicEvent } from '@/lib/events/public-event';


/** Seats left as a short badge, or null when there is no limit worth mentioning. */
export function seatsBadge(ev: Pick<PublicEvent, 'spotsLeft' | 'isPast'>): { label: string; tone: 'full' | 'low' } | null {
  if (ev.isPast || ev.spotsLeft === null) return null;
  if (ev.spotsLeft <= 0) return { label: 'Full', tone: 'full' };
  if (ev.spotsLeft <= 10) return { label: `${ev.spotsLeft} spot${ev.spotsLeft === 1 ? '' : 's'} left`, tone: 'low' };
  return null;
}

export const BADGE_STYLE = {
  full: { background: '#fef2f2', color: '#b91c1c' },
  low: { background: '#fffbeb', color: '#b45309' },
} as const;

/**
 * One event in the /events grid, drawn like the courses on the landing page: the cover edge to edge
 * with the date on a calendar tag, then the format, title, when and where, a short summary and a
 * Register button.
 */
export function EventCard({ ev, primaryColor }: { ev: PublicEvent; primaryColor: string }) {
  const date = dateParts(displayDate(ev));
  const time = displayTime(ev.time);
  const repeat = recurrenceLabel(ev);
  const badge = seatsBadge(ev);
  const open = !ev.isPast && badge?.tone !== 'full';
  return (
    <Link href={`/events/${encodeURIComponent(ev.slug)}`} className={FRAMED_CARD}
      style={{ background: 'var(--ev-surface,#ffffff)', textDecoration: 'none', opacity: ev.isPast ? 0.85 : 1 }}>
      <div className="relative flex aspect-video items-center justify-center overflow-hidden" style={{ background: 'var(--ev-line,#E8EEF0)' }}>
        {ev.coverImage
          ? <img src={resolveCoverUrl(ev.coverImage)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
          : <CalendarDays className="h-10 w-10" style={{ color: '#94a3b8' }} />}
        {date && (
          <div className="absolute left-3 top-3 w-12 overflow-hidden rounded-lg text-center" style={{ background: '#ffffff', boxShadow: '0 4px 14px -6px rgba(15,23,42,0.35)' }}>
            <div className="py-0.5 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>{date.month.charAt(0)}{date.month.slice(1).toLowerCase()}</div>
            <div className="py-0.5 text-lg font-extrabold" style={{ color: '#0f172a' }}>{date.day}</div>
          </div>
        )}
        {badge && (
          <span className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold" style={BADGE_STYLE[badge.tone]}>{badge.label}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col px-4 pt-3.5 pb-[18px]">
        <p className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>
          {ev.format === 'virtual' ? <Video className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
          {ev.format === 'virtual' ? 'Online' : 'In person'}
          {repeat && <span>| {repeat}</span>}
        </p>
        <p className="mt-1 line-clamp-2 min-h-[40px] text-[15px] leading-5 font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>{ev.title}</p>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>
          {date ? date.long : 'Date to be announced'}{time ? ` at ${time}` : ''}{ev.timezone && time ? ` ${ev.timezone}` : ''}
        </p>
        {ev.venue && <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>{ev.venue.name}</p>}
        {ev.summary && <p className="mt-2 line-clamp-2 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>{ev.summary}</p>}
        {/* Looks like a button; the whole card is the link (a real button cannot sit inside one). */}
        <div className="mt-auto pt-4">
          <span className="flex h-10 w-full items-center justify-center rounded-xl text-sm font-semibold transition-opacity group-hover:opacity-90"
            style={open ? { background: primaryColor, color: 'var(--ev-on-accent,#ffffff)' } : { background: 'var(--ev-soft,#f1f5f9)', color: 'var(--ev-body,#334155)' }}>
            {ev.isPast ? 'View event' : open ? 'Register' : 'View details'}
          </span>
        </div>
      </div>
    </Link>
  );
}
