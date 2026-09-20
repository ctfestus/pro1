import type { Metadata } from 'next';
import { getLandingProgrammesOrEmpty, getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveConfig } from '@/lib/site-templates';
import { LegalPageClient } from '@/components/legal/LegalPageClient';
import { termsOfUse } from '@/lib/legal-content';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getTenantSettings();
  return {
    title: `Terms of Use - ${settings.appName}`,
    description: 'The terms that govern your account and your use of the platform.',
  };
}

/** The public terms of use. Its wording comes from lib/legal-content, filled in per tenant. */
export default async function TermsPage() {
  const [site, tenant, programmes] = await Promise.all([
    getLandingSiteSettingsOrDefault(),
    getTenantSettings(),
    // Only for the shared nav's Learn menu, so this page navigates like the other public pages.
    getLandingProgrammesOrEmpty(),
  ]);
  const config = resolveConfig(site.template, site.config);

  return (
    <LegalPageClient
      doc={termsOfUse({
        appName: tenant.appName,
        orgName: tenant.orgName,
        supportEmail: tenant.supportEmail,
        operatorCountry: tenant.operatorCountry,
      })}
      siteConfig={config}
      primaryColor={config.primaryColor || tenant.primaryColor}
      accentColor={config.accentColor || tenant.accentColor}
      headingFont={config.headingFont}
      bodyFont={config.bodyFont}
      programmes={programmes}
    />
  );
}
