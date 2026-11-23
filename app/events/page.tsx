import type { Metadata } from 'next';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { listNavBooks } from '@/lib/books/store';
import { listPublicEventsOrEmpty, toNavEvents } from '@/lib/events/store';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { EventCatalogue } from '@/components/events/store/EventCatalogue';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return {
    title: `Events - ${tenant.appName}`,
    description: 'Upcoming live sessions, workshops and meetups. Register free in a minute.',
  };
}

/**
 * The public events page: every published event open to public registration and not unlisted,
 * upcoming first. Rendered on the server from lib/events/store.ts (cached for a minute, refreshed
 * on every event save and registration) so it can be shared and indexed.
 */
export default async function EventsPage() {
  const [events, site, tenant, programmes, navBooks] = await Promise.all([
    listPublicEventsOrEmpty(),
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    getLandingProgrammesOrEmpty(),
    listNavBooks(),
  ]);
  const config = resolveConfig(site.config);
  const primaryColor = config.primaryColor || tenant.primaryColor;
  const navEvents = toNavEvents(events.upcoming);

  return (
    <StoreChrome siteConfig={config} primaryColor={primaryColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks} navEvents={navEvents}>
      <section className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pt-10 sm:pt-14 pb-16">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight" style={{ color: '#0f172a' }}>Events</h1>
        <p className="mt-3 max-w-2xl text-base" style={{ color: '#475569' }}>
          Live sessions, workshops and meetups. Register free in a minute and we will email you the details and a reminder.
        </p>
        <div className="mt-8">
          <EventCatalogue upcoming={events.upcoming} past={events.past} />
        </div>
      </section>
    </StoreChrome>
  );
}
