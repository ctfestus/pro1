import Link from 'next/link';
import { CalendarDays, MapPin, Video } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { CARD_SHADOW } from '@/components/books/store/card-style';
import { dateParts, displayDate, displayTime, recurrenceLabel, type PublicEvent } from '@/lib/events/public-event';


/** Seats left as a short badge, or null when there is no limit worth mentioning. */
export function seatsBadge(ev: Pick<PublicEvent, 'spotsLeft' | 'isPast'>): { label: string; tone: 'full' | 'low' } | null {
  if (ev.isPast || ev.spotsLeft === null) return null;
  if (ev.spotsLeft <= 0) return { label: 'Sold out', tone: 'full' };
  if (ev.spotsLeft <= 10) return { label: `${ev.spotsLeft} spot${ev.spotsLeft === 1 ? '' : 's'} left`, tone: 'low' };
  return null;
}

export const BADGE_STYLE = {
  full: { background: '#fef2f2', color: '#b91c1c' },
  low: { background: '#fffbeb', color: '#b45309' },
} as const;

/** One event in the /events grid: cover with a date chip, then title, when and where. */
export function EventCard({ ev, primaryColor }: { ev: PublicEvent; primaryColor: string }) {
  const date = dateParts(displayDate(ev));
  const time = displayTime(ev.time);
  const repeat = recurrenceLabel(ev);
  const badge = seatsBadge(ev);
  return (
    <Link href={`/events/${encodeURIComponent(ev.slug)}`}
      className="group flex flex-col rounded-2xl overflow-hidden bg-white transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: CARD_SHADOW, opacity: ev.isPast ? 0.85 : 1 }}>
      <div className="relative aspect-[16/9] overflow-hidden" style={{ background: '#e2e8f0' }}>
        {ev.coverImage ? (
          <img src={resolveCoverUrl(ev.coverImage)} alt="" loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: `${primaryColor}14` }}>
            <CalendarDays className="w-10 h-10" style={{ color: primaryColor }} />
          </div>
        )}
        {date && (
          <div className="absolute top-3 left-3 w-12 rounded-xl bg-white text-center overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
            <div className="text-[10px] font-bold tracking-wider py-0.5" style={{ background: primaryColor, color: '#ffffff' }}>{date.month}</div>
            <div className="text-lg font-extrabold py-0.5" style={{ color: '#0f172a' }}>{date.day}</div>
          </div>
        )}
        {badge && (
          <span className="absolute top-3 right-3 rounded-full px-2.5 py-1 text-[11px] font-bold" style={BADGE_STYLE[badge.tone]}>{badge.label}</span>
        )}
      </div>
      <div className="flex-1 flex flex-col p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] flex items-center gap-1.5" style={{ color: '#475569' }}>
          {ev.format === 'virtual' ? <Video className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
          {ev.format === 'virtual' ? 'Online' : 'In person'}
          {repeat && <span className="font-semibold normal-case tracking-normal" style={{ color: '#64748b' }}>| {repeat}</span>}
        </p>
        <h3 className="mt-2 text-base sm:text-lg font-bold leading-snug line-clamp-2" style={{ color: '#0f172a' }}>{ev.title}</h3>
        <p className="mt-1.5 text-sm" style={{ color: '#475569' }}>
          {date ? date.long : 'Date to be announced'}{time ? ` at ${time}` : ''}{ev.timezone && time ? ` ${ev.timezone}` : ''}
        </p>
        {ev.venue && <p className="mt-0.5 text-sm truncate" style={{ color: '#64748b' }}>{ev.venue.name}</p>}
        {ev.summary && <p className="mt-3 text-sm line-clamp-2" style={{ color: '#64748b' }}>{ev.summary}</p>}
        {/* Looks like a button; the whole card is the link (a real button cannot sit inside one). */}
        <div className="mt-auto pt-4">
          {(() => {
            const open = !ev.isPast && badge?.tone !== 'full';
            return (
              <span className="flex h-10 w-full items-center justify-center rounded-xl text-sm font-bold transition-opacity group-hover:opacity-90"
                style={open ? { background: primaryColor, color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>
                {ev.isPast ? 'View event' : open ? 'Register' : 'View details'}
              </span>
            );
          })()}
        </div>
      </div>
    </Link>
  );
}
