import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { listNavBooks } from '@/lib/books/store';
import { getPublicEvent, listPublicEventsOrEmpty, toNavEvents, type PublicEventDetail } from '@/lib/events/store';
import { eventJsonLd, eventMetadata } from '@/lib/events/share';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { EventPageView } from '@/components/events/store/EventPageView';

type Params = { params: Promise<{ slug: string }> };

/** A lookup failure shows "not found" rather than an error page. */
async function findEvent(slug: string): Promise<PublicEventDetail | null> {
  try {
    return await getPublicEvent(slug);
  } catch (e: any) {
    console.error('[events/page] lookup failed', e?.message ?? e);
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [event, tenant] = await Promise.all([findEvent(slug), getTenantSettings()]);
  if (!event) return { title: tenant.appName };
  const appUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  return eventMetadata(event, tenant.appName, appUrl);
}

/**
 * A public event's page. Only events that are published and open to public registration exist
 * here (lib/events/store.ts); cohort-only events keep their page at /<slug>. An unlisted event is
 * reachable by its link but left off /events and out of search.
 */
export default async function EventPage({ params }: Params) {
  const { slug } = await params;
  const [event, site, tenant, programmes, navBooks, events] = await Promise.all([
    findEvent(slug),
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    getLandingProgrammesOrEmpty(),
    listNavBooks(),
    listPublicEventsOrEmpty(),
  ]);
  if (!event) notFound();
  const config = resolveConfig(site.template, site.config);
  const primaryColor = config.primaryColor || tenant.primaryColor;
  const baseUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  const shareUrl = baseUrl ? `${baseUrl}/events/${encodeURIComponent(event.slug)}` : '';
  const more = events.upcoming.filter(e => e.id !== event.id).slice(0, 3);
  const navEvents = toNavEvents(events.upcoming);
  // JSON in a script tag: escape "<" so a title can never close the tag.
  const jsonLd = JSON.stringify(eventJsonLd(event, tenant.appName, baseUrl)).replace(/</g, '\\u003c');

  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor} accentColor={config.accentColor || tenant.accentColor || primaryColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks} navEvents={navEvents}>
      {event.listed && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
      <EventPageView event={event} more={more} primaryColor={primaryColor} shareUrl={shareUrl} />
    </StoreChrome>
  );
}
