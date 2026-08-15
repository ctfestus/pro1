import LandingPageClient from '@/components/LandingPageClient';
import { getLandingPageData } from '@/lib/get-landing-page-data';

type LandingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const [params, data] = await Promise.all([
    searchParams,
    getLandingPageData(),
  ]);

  return (
    <LandingPageClient
      initialTemplateId={data.template}
      initialSiteConfig={data.config}
      initialProgrammes={data.programmes}
      programmesError={data.programmesError}
      isPreview={'_preview' in params}
    />
  );
}
