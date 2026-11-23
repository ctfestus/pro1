import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault, type ProgrammeItem } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { listNavBooks } from '@/lib/books/store';
import { listNavEvents } from '@/lib/events/store';
import { StoreChrome } from '@/components/books/store/StoreChrome';
import { CatalogueBrowse } from '@/components/landing/CatalogueBrowse';

/**
 * The page behind /courses, /learning-paths, /virtual-experiences and /certifications: the shared
 * store nav and footer, a heading and one line, then the catalogue (CatalogueBrowse). Server
 * rendered from the landing page's cached programmes, so it can be shared and indexed.
 */
export async function CataloguePage({ type, title, line, noun }: {
  type: ProgrammeItem['type']; title: string; line: string; noun: string;
}) {
  const [programmes, site, tenant, navBooks, navEvents] = await Promise.all([
    getLandingProgrammesOrEmpty(),
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    listNavBooks(),
    listNavEvents(),
  ]);
  const config = resolveConfig(site.config);
  const font = config.bodyFont ? `'${config.bodyFont}', sans-serif` : undefined;
  return (
    <StoreChrome siteConfig={config} primaryColor={config.primaryColor || tenant.primaryColor}
      bodyFont={config.bodyFont} programmes={programmes} navBooks={navBooks} navEvents={navEvents}>
      <section className="mx-auto max-w-[1240px] px-4 pt-10 pb-16 sm:px-6 sm:pt-14 md:px-10">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: '#0f172a' }}>{title}</h1>
        <p className="mt-3 max-w-2xl text-base" style={{ color: '#475569' }}>{line}</p>
        <div className="mt-8">
          <CatalogueBrowse items={programmes.filter(item => item.type === type)} noun={noun} font={font} />
        </div>
      </section>
    </StoreChrome>
  );
}
