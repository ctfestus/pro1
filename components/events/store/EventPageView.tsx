import Link from 'next/link';
import { CalendarDays, ChevronRight, Clock, MapPin, Repeat, UserRound, Users, Video } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { sessionStartInstant } from '@/lib/event-sessions';
import { descriptionSections } from '@/lib/books/description';
import { getFontById } from '@/lib/fonts';
import { EVENT_THEME_CSS, textOn } from '@/lib/events/page-theme';
import { dateParts, displayDate, displayTime, recurrenceLabel, type PublicEvent } from '@/lib/events/public-event';
import type { PublicEventDetail } from '@/lib/events/store';
import { InstructorLinks } from '@/components/books/store/InstructorLinks';
import { EventCard, BADGE_STYLE, seatsBadge } from '@/components/events/store/EventCard';
import { CARD_SHADOW } from '@/components/books/store/card-style';
import { RegisterPanel } from '@/components/events/store/RegisterPanel';
import { LocalTime } from '@/components/events/store/LocalTime';
import { ShareButtons } from '@/components/ShareButtons';

/**
 * One line of the hero facts. With href (the venue), the whole fact opens the map, and on hover
 * both lines take the event's colour (no underline).
 */
function Fact({ icon, title, sub, href, label, accent }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; href?: string; label?: string; accent?: string }) {
  const hover = href ? ' transition-colors group-hover:text-[var(--fact-hover)]' : '';
  const body = (
    <>
      <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-[var(--ev-surface,#ffffff)] flex items-center justify-center" style={{ boxShadow: CARD_SHADOW, color: 'var(--ev-body,#334155)' }}>{icon}</div>
      <div className="min-w-0 pt-0.5">
        <div className={`text-base font-semibold text-[var(--ev-text,#0f172a)]${hover}`}>{title}</div>
        {sub && <div className={`mt-0.5 text-sm text-[var(--ev-muted,#64748b)]${hover}`}>{sub}</div>}
      </div>
    </>
  );
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="group flex items-start gap-3"
        style={{ ['--fact-hover' as any]: accent ?? 'var(--ev-text,#0f172a)' }}>{body}</a>
    : <div className="flex items-start gap-3">{body}</div>;
}

const SECTION = 'rounded-3xl bg-[var(--ev-surface,#ffffff)] p-5 sm:p-6';
const SECTION_STYLE = { boxShadow: CARD_SHADOW };
const SECTION_TITLE = 'text-[22px] leading-7 font-bold tracking-tight';

/** A person's photo, or a plain person icon when there is none. */
function Avatar({ src, size }: { src: string | null; size: number }) {
  return (
    <span className="flex-shrink-0 overflow-hidden rounded-full inline-flex items-center justify-center"
      style={{ width: size, height: size, background: 'var(--ev-soft,#f1f5f9)', color: 'var(--ev-muted,#64748b)' }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <UserRound style={{ width: size / 2, height: size / 2 }} />}
    </span>
  );
}

/**
 * A public event's page, in the event's own Appearance settings (colour, light or dark mode, font)
 * through the .event-theme variables (lib/events/page-theme.ts):
 *   hero   cover, format, title, when, where and seats; the register box beside it (below it on
 *          phones, straight after the facts so it is never far away)
 *   body   the description on the page, one titled block per heading; speakers, the host and
 *          sharing in cards; then other upcoming events
 */
export function EventPageView({ event, more, primaryColor, shareUrl, memberPanel }: {
  event: PublicEventDetail;
  more: PublicEvent[];
  primaryColor: string;
  shareUrl: string;
  /** The cohort page (/<slug>): this box (Join, Add to calendar) instead of the register box, and no
   *  breadcrumb to /events or sharing, since the event is only for its cohort. */
  memberPanel?: React.ReactNode;
}) {
  const date = dateParts(displayDate(event));
  const time = displayTime(event.time);
  const repeat = recurrenceLabel(event);
  const badge = seatsBadge(event);
  const mapsUrl = event.location ? `https://maps.google.com/?q=${encodeURIComponent(event.location)}` : null;
  // One card per heading in the description (About this event, What you will learn...).
  const sections = descriptionSections(event.description).map((sec, i) => (i === 0 ? { ...sec, title: 'About this event' } : sec));
  // The event's own font from its Appearance step (lib/fonts.ts); none keeps the site font.
  const font = event.font ? getFontById(event.font) : null;
  // Only a timed upcoming session counts down: an untimed one has no real start to count to.
  const startsAt = event.nextDate && event.time ? sessionStartInstant(event.nextDate, event.time, event.timezone)?.toISOString() ?? null : null;

  return (
    <div className="event-theme" data-mode={event.mode}
      style={{ background: 'var(--ev-bg)', color: 'var(--ev-text)', fontFamily: font?.cssFamily, ['--ev-on-accent' as any]: textOn(primaryColor) }}>
      <style>{EVENT_THEME_CSS}</style>
      {font?.googleFamily && (
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${font.googleFamily}&display=swap`} />
      )}
    <section className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-5 sm:pt-8 pb-16">
      {!memberPanel && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>
          <Link href="/events" className="font-medium hover:underline" style={{ color: 'var(--ev-body,#334155)' }}>Events</Link>
          <ChevronRight className="w-3.5 h-3.5" /><span className="truncate">{event.title}</span>
        </nav>
      )}

      <div className="mt-5 sm:mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 items-start">
        <div className="min-w-0 space-y-8">
          <div className="relative aspect-[16/9] rounded-3xl overflow-hidden" style={{ background: 'var(--ev-line,#e2e8f0)' }}>
            {event.coverImage ? (
              <img src={resolveCoverUrl(event.coverImage)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: `${primaryColor}14` }}>
                <CalendarDays className="w-14 h-14" style={{ color: primaryColor }} />
              </div>
            )}
          </div>

          <header>
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ev-body2,#475569)' }}>
              {event.format === 'virtual' ? 'Online event' : 'In person event'}
              {event.isPast && <span className="rounded-full px-3 py-0.5" style={{ background: 'var(--ev-line,#e2e8f0)', color: 'var(--ev-body,#334155)' }}>Ended</span>}
              {badge && <span className="rounded-full px-3 py-0.5" style={BADGE_STYLE[badge.tone]}>{badge.label}</span>}
            </p>
            <h1 className="mt-2 text-[28px] leading-9 sm:text-[36px] sm:leading-[44px] font-extrabold tracking-tight" style={{ color: 'var(--ev-text,#0f172a)' }}>{event.title}</h1>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Fact icon={<CalendarDays className="w-5 h-5" />}
                title={date ? date.long : 'Date to be announced'}
                sub={time ? (
                  <>
                    <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {time}{event.timezone ? ` ${event.timezone}` : ''}</span>
                    {/* The visitor's own time, in their browser only. A finished event has no next date, so nothing shows. */}
                    <LocalTime date={event.nextDate} time={event.time} timezone={event.timezone} />
                  </>
                ) : undefined} />
              {event.format === 'virtual' ? (
                <Fact icon={<Video className="w-5 h-5" />} title="Online" sub={memberPanel ? 'Join from this page' : 'We email your join link once you register'} />
              ) : (
                <Fact icon={<MapPin className="w-5 h-5" />}
                  title={event.venue?.name ?? 'Venue to be announced'}
                  sub={event.venue?.address ?? undefined}
                  href={event.venue && mapsUrl ? mapsUrl : undefined}
                  label={event.venue ? `Open ${event.venue.name} in Google Maps` : undefined}
                  accent={primaryColor} />
              )}
              {repeat && <Fact icon={<Repeat className="w-5 h-5" />} title={repeat} sub={memberPanel ? undefined : 'One registration covers every session'} />}
              {event.capacity !== null && !event.isPast && (
                <Fact icon={<Users className="w-5 h-5" />}
                  title={event.spotsLeft === 0 ? 'Full' : `${event.spotsLeft} of ${event.capacity} spots left`} />
              )}
            </div>
          </header>

          {/* Phones: the register box straight after the facts. */}
          <div className="lg:hidden">
            {memberPanel ?? <RegisterPanel event={event} primaryColor={primaryColor} pageUrl={shareUrl} startsAt={startsAt} after={event.after} />}
          </div>

          {/* The event details sit on the page itself, one block per heading; people and sharing get cards. */}
          {sections.map(sec => (
            <section key={sec.title}>
              <h2 className={SECTION_TITLE} style={{ color: 'var(--ev-text,#0f172a)' }}>{sec.title}</h2>
              <div className="rich-preview mt-3 text-base leading-relaxed" style={{ color: 'var(--ev-body,#334155)' }}
                dangerouslySetInnerHTML={{ __html: sec.html }} />
            </section>
          ))}

          {event.speakers.length > 0 && (
            <section className={SECTION} style={SECTION_STYLE}>
              <h2 className={SECTION_TITLE} style={{ color: 'var(--ev-text,#0f172a)' }}>{event.speakers.length > 1 ? 'Speakers' : 'Speaker'}</h2>
              <ul className="mt-2">
                {event.speakers.map((sp, i) => (
                  <li key={`${sp.name}-${i}`} className="flex gap-4 py-4" style={i ? { borderTop: '1px solid var(--ev-line,#e2e8f0)' } : undefined}>
                    <Avatar src={sp.avatar} size={48} />
                    <div className="min-w-0">
                      <p className="text-base font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>{sp.name}</p>
                      {sp.title && <p className="mt-0.5 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>{sp.title}</p>}
                      {sp.bio && <p className="mt-2 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>{sp.bio}</p>}
                      {sp.linkedin && <InstructorLinks name={sp.name} links={[{ key: 'linkedin', url: sp.linkedin }]} />}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {event.host && (
            <section className={SECTION} style={SECTION_STYLE}>
              <h2 className={SECTION_TITLE} style={{ color: 'var(--ev-text,#0f172a)' }}>Hosted by</h2>
              <div className="mt-4 flex gap-4">
                <Avatar src={event.host.avatar ? resolveCoverUrl(event.host.avatar) : null} size={56} />
                <div className="min-w-0">
                  <p className="text-base font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>{event.host.name}</p>
                  {event.host.bio && <p className="mt-2 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>{event.host.bio}</p>}
                  <InstructorLinks name={event.host.name} links={event.host.links} />
                </div>
              </div>
            </section>
          )}

          {!memberPanel && (
            <section aria-label="Share" className={SECTION} style={SECTION_STYLE}>
              <ShareButtons url={shareUrl} title={event.title} blurb={event.summary} />
            </section>
          )}
        </div>

        <aside className="hidden lg:block lg:sticky lg:top-24">
          {memberPanel ?? <RegisterPanel event={event} primaryColor={primaryColor} pageUrl={shareUrl} startsAt={startsAt} after={event.after} />}
        </aside>
      </div>

      {more.length > 0 && (
        <div className="mt-16">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-[22px] leading-7 font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>More upcoming events</h2>
            <Link href="/events" className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--ev-text,#0f172a)' }}>See all <ChevronRight className="w-4 h-4" /></Link>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {more.map(ev => <EventCard key={ev.id} ev={ev} primaryColor={primaryColor} />)}
          </div>
        </div>
      )}
    </section>
    </div>
  );
}
