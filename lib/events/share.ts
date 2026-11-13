import type { Metadata } from 'next';
import { socialImageUrl } from '@/lib/cloudinary-url';
import { sessionStartInstant } from '@/lib/event-sessions';
import { dateParts, displayDate, displayTime, type PublicEvent } from '@/lib/events/public-event';

/** Link-preview and search metadata for a public event page. */
export function eventMetadata(ev: PublicEvent, appName: string, appUrl: string): Metadata {
  const cover = ev.coverImage && !ev.coverImage.startsWith('data:') ? socialImageUrl(ev.coverImage) : '';
  const image = cover || (appUrl ? `${appUrl}/api/og/brand` : '');
  const date = dateParts(displayDate(ev));
  const time = displayTime(ev.time);
  const when = date ? `${date.long}${time ? `, ${time}${ev.timezone ? ` ${ev.timezone}` : ''}` : ''}` : '';
  const where = ev.format === 'virtual' ? 'Online' : (ev.location ?? '');
  const lead = [when, where].filter(Boolean).join(' | ');
  const description = [lead, ev.summary].filter(Boolean).join('. ') || `${ev.title}, an event from ${appName}.`;
  const url = appUrl ? `${appUrl}/events/${encodeURIComponent(ev.slug)}` : undefined;
  return {
    title: `${ev.title} - ${appName}`,
    description,
    alternates: url ? { canonical: url } : undefined,
    robots: ev.listed ? undefined : { index: false, follow: false },
    openGraph: {
      title: ev.title, description, siteName: appName, type: 'website', ...(url ? { url } : {}),
      ...(image ? { images: [{ url: image, alt: ev.title }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: ev.title, description, ...(image ? { images: [image] } : {}) },
  };
}

/** schema.org Event data, so search engines can show the event with its date and place. */
export function eventJsonLd(ev: PublicEvent, appName: string, appUrl: string): Record<string, unknown> {
  const day = displayDate(ev);
  const start = day ? (ev.time ? sessionStartInstant(day, ev.time, ev.timezone)?.toISOString() : day) : undefined;
  const url = appUrl ? `${appUrl}/events/${encodeURIComponent(ev.slug)}` : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.title,
    description: ev.summary || undefined,
    startDate: start,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: ev.format === 'virtual'
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location: ev.format === 'virtual'
      ? { '@type': 'VirtualLocation', url }
      : { '@type': 'Place', name: ev.location ?? 'To be announced', address: ev.location ?? undefined },
    image: ev.coverImage && !ev.coverImage.startsWith('data:') ? [socialImageUrl(ev.coverImage)] : undefined,
    organizer: { '@type': 'Organization', name: appName, url: appUrl || undefined },
    offers: {
      '@type': 'Offer', price: 0, priceCurrency: 'USD', url,
      availability: ev.spotsLeft === 0 ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    },
    performer: ev.speakers.length ? ev.speakers.map(s => ({ '@type': 'Person', name: s.name })) : undefined,
  };
}
