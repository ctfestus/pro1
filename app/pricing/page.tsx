import type { Metadata } from 'next';
import { getPricingPageData } from '@/lib/get-pricing-page-data';
import { getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { PricingPageClient } from '@/components/pricing/PricingPageClient';
import { hasMidAds, midAdCardsFrom } from '@/lib/mid-ads';
import { paystackIsConfigured } from '@/lib/paystack';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getTenantSettings();
  return {
    title: `Pricing - ${settings.appName}`,
    description: 'Start free, then pay only for the access you use. Compare what each plan includes.',
  };
}

/**
 * The public pricing page.
 *
 * A visitor could see a price on a course they had already found, but nothing anywhere listed
 * the plans -- so anyone deciding before they had picked a course had nothing to read. This is
 * that page, and every number on it comes from what an admin configured.
 */
export default async function PricingPage() {
  const [data, site, tenant] = await Promise.all([
    getPricingPageData(),
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
  ]);
  const config = resolveConfig(site.template, site.config);

  return (
    <PricingPageClient
      plans={data.plans}
      free={data.free}
      siteConfig={config}
      primaryColor={config.primaryColor || tenant.primaryColor}
      accentColor={config.accentColor || tenant.accentColor}
      headingFont={config.headingFont}
      bodyFont={config.bodyFont}
      supportEmail={tenant.supportEmail}
      midAds={hasMidAds(config) ? midAdCardsFrom(config) : undefined}
      paystackEnabled={paystackIsConfigured()}
    />
  );
}
