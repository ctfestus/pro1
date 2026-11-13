import Link from 'next/link';
import { CalendarDays, ChevronRight, Clock, MapPin, Repeat, Users, Video } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { sessionStartInstant } from '@/lib/event-sessions';
import { sanitizeRichText } from '@/lib/sanitize';
import { getFontById } from '@/lib/fonts';
import { EVENT_THEME_CSS, textOn } from '@/lib/events/page-theme';
import { dateParts, displayDate, displayTime, recurrenceLabel, type PublicEvent } from '@/lib/events/public-event';
import type { PublicEventDetail } from '@/lib/events/store';
import { InstructorLinks } from '@/components/books/store/InstructorLinks';
import { EventCard, BADGE_STYLE, seatsBadge } from '@/components/events/store/EventCard';
import { CARD_SHADOW, initials } from '@/components/books/store/card-style';
import { RegisterPanel } from '@/components/events/store/RegisterPanel';
import { ShareButtons } from '@/components/ShareButtons';

/** One line of the hero facts. With href (the venue), the whole fact opens the map. */
function Fact({ icon, title, sub, href, label }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; href?: string; label?: string }) {
  const body = (
    <>
      <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-[var(--ev-surface,#ffffff)] flex items-center justify-center" style={{ boxShadow: CARD_SHADOW, color: 'var(--ev-body,#334155)' }}>{icon}</div>
      <div className="min-w-0 pt-0.5">
        <div className={`text-base font-semibold${href ? ' underline-offset-4 group-hover:underline' : ''}`} style={{ color: 'var(--ev-text,#0f172a)' }}>{title}</div>
        {sub && <div className="mt-0.5 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>{sub}</div>}
      </div>
    </>
  );
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="group flex items-start gap-3">{body}</a>
    : <div className="flex items-start gap-3">{body}</div>;
}

/**
 * A public event's page, in the event's own Appearance settings (colour, light or dark mode, font)
 * through the .event-theme variables (lib/events/page-theme.ts):
 *   hero   cover, format, title, when, where and seats; the register box beside it (below it on
 *          phones, straight after the facts so it is never far away)
 *   body   about (rich text), speakers, the host, then other upcoming events
 */
export function EventPageView({ event, more, primaryColor, shareUrl }: {
  event: PublicEventDetail;
  more: PublicEvent[];
  primaryColor: string;
  shareUrl: string;
}) {
  const date = dateParts(displayDate(event));
  const time = displayTime(event.time);
  const repeat = recurrenceLabel(event);
  const badge = seatsBadge(event);
  const mapsUrl = event.location ? `https://maps.google.com/?q=${encodeURIComponent(event.location)}` : null;
  const aboutHtml = event.description ? sanitizeRichText(event.description) : '';
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
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>
        <Link href="/events" className="font-medium hover:underline" style={{ color: 'var(--ev-body,#334155)' }}>Events</Link>
        <ChevronRight className="w-3.5 h-3.5" /><span className="truncate">{event.title}</span>
      </nav>

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
            <p className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--ev-body2,#475569)' }}>
              {event.format === 'virtual' ? 'Online event' : 'In person event'}
              {event.isPast && <span className="rounded-full px-2.5 py-0.5 normal-case tracking-normal" style={{ background: 'var(--ev-line,#e2e8f0)', color: 'var(--ev-body,#334155)' }}>Ended</span>}
              {badge && <span className="rounded-full px-2.5 py-0.5 normal-case tracking-normal" style={BADGE_STYLE[badge.tone]}>{badge.label}</span>}
            </p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight" style={{ color: 'var(--ev-text,#0f172a)' }}>{event.title}</h1>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Fact icon={<CalendarDays className="w-5 h-5" />}
                title={date ? date.long : 'Date to be announced'}
                sub={time ? <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {time}{event.timezone ? ` ${event.timezone}` : ''}</span> : undefined} />
              {event.format === 'virtual' ? (
                <Fact icon={<Video className="w-5 h-5" />} title="Online" sub="We email your join link once you register" />
              ) : (
                <Fact icon={<MapPin className="w-5 h-5" />}
                  title={event.venue?.name ?? 'Venue to be announced'}
                  sub={event.venue?.address ?? undefined}
                  href={event.venue && mapsUrl ? mapsUrl : undefined}
                  label={event.venue ? `Open ${event.venue.name} in Google Maps` : undefined} />
              )}
              {repeat && <Fact icon={<Repeat className="w-5 h-5" />} title={repeat} sub="One registration covers every session" />}
              {event.capacity !== null && !event.isPast && (
                <Fact icon={<Users className="w-5 h-5" />}
                  title={event.spotsLeft === 0 ? 'Sold out' : `${event.spotsLeft} of ${event.capacity} spots left`} />
              )}
            </div>
          </header>

          {/* Phones: the register box straight after the facts. */}
          <div className="lg:hidden">
            <RegisterPanel event={event} primaryColor={primaryColor} pageUrl={shareUrl} startsAt={startsAt} after={event.after} />
          </div>

          {aboutHtml && (
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>About this event</h2>
              <div className="rich-preview mt-3 text-base leading-relaxed" style={{ color: 'var(--ev-body,#334155)' }}
                dangerouslySetInnerHTML={{ __html: aboutHtml }} />
            </div>
          )}

          {event.speakers.length > 0 && (
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>Speakers</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {event.speakers.map((sp, i) => (
                  <div key={`${sp.name}-${i}`} className="flex gap-3 rounded-2xl bg-[var(--ev-surface,#ffffff)] p-4" style={{ boxShadow: CARD_SHADOW }}>
                    <div className="w-12 h-12 flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold"
                      style={{ background: `${primaryColor}18`, color: primaryColor }}>
                      {sp.avatar ? <img src={sp.avatar} alt="" className="w-full h-full object-cover" /> : initials(sp.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>{sp.name}</p>
                      {sp.title && <p className="text-xs mt-0.5" style={{ color: 'var(--ev-muted,#64748b)' }}>{sp.title}</p>}
                      {sp.bio && <p className="text-sm mt-2 line-clamp-4" style={{ color: 'var(--ev-body2,#475569)' }}>{sp.bio}</p>}
                      {sp.linkedin && (
                        <a href={sp.linkedin} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold" style={{ color: '#0A66C2' }}>LinkedIn</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {event.host && (
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>Hosted by</h2>
              <div className="mt-4 flex gap-4 rounded-2xl bg-[var(--ev-surface,#ffffff)] p-5" style={{ boxShadow: CARD_SHADOW }}>
                <div className="w-14 h-14 flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center font-bold"
                  style={{ background: `${primaryColor}18`, color: primaryColor }}>
                  {event.host.avatar ? <img src={resolveCoverUrl(event.host.avatar)} alt="" className="w-full h-full object-cover" /> : initials(event.host.name)}
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>{event.host.name}</p>
                  {event.host.bio && <p className="mt-1.5 text-sm" style={{ color: 'var(--ev-body2,#475569)' }}>{event.host.bio}</p>}
                  <InstructorLinks name={event.host.name} links={event.host.links} />
                </div>
              </div>
            </div>
          )}

          <ShareButtons url={shareUrl} title={event.title} blurb={event.summary} />
        </div>

        <aside className="hidden lg:block lg:sticky lg:top-24">
          <RegisterPanel event={event} primaryColor={primaryColor} pageUrl={shareUrl} startsAt={startsAt} after={event.after} />
        </aside>
      </div>

      {more.length > 0 && (
        <div className="mt-16">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-bold" style={{ color: 'var(--ev-text,#0f172a)' }}>More upcoming events</h2>
            <Link href="/events" className="text-sm font-semibold hover:underline" style={{ color: primaryColor }}>See all</Link>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {more.map(ev => <EventCard key={ev.id} ev={ev} primaryColor={primaryColor} />)}
          </div>
        </div>
      )}
    </section>
    </div>
  );
}
