/**
 * Server-only. Returns branding settings from the database,
 * falling back to env vars (lib/tenant.ts) if no DB row exists.
 *
 * Cached for 60 seconds via Next.js data cache.
 * Call revalidateTag('tenant-settings') after admin saves to bust the cache immediately.
 */
import { unstable_cache } from 'next/cache';
import { adminClient } from './admin-client';
import { tenant } from './tenant';

export type TenantSettings = typeof tenant;

export const getTenantSettings = unstable_cache(
  async (): Promise<TenantSettings> => {
    try {
      const { data } = await adminClient()
        .from('platform_settings')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      if (!data) return tenant;

      return {
        appName:      data.app_name      || tenant.appName,
        appDescription: data.app_description || tenant.appDescription,
        orgName:      data.org_name      || tenant.orgName,
        appUrl:       (data.app_url       || tenant.appUrl).replace(/\/$/, ''),
        logoUrl:      data.logo_url       || tenant.logoUrl,
        logoDarkUrl:  data.logo_dark_url || tenant.logoDarkUrl,
        teamName:     data.team_name     || tenant.teamName,
        senderName:   data.sender_name   || tenant.senderName,
        supportEmail: data.support_email || tenant.supportEmail,
        brandColor:      data.brand_color      || tenant.brandColor,
        faviconUrl:      data.favicon_url      || tenant.faviconUrl,
        emailBannerUrl:  data.email_banner_url || tenant.emailBannerUrl,
        whatsappCommunityUrl: data.whatsapp_community_url || tenant.whatsappCommunityUrl,
        // ?? not ||, and Boolean() not a bare pass-through: this is the only boolean in the
        // contract, and || would silently rewrite a stored false into the env fallback -- turning
        // signups back on for any tenant whose env said true. A stored false must stay false.
        publicSignupEnabled: data.public_signup_enabled ?? tenant.publicSignupEnabled,
        primaryColor:    data.primary_color    || tenant.primaryColor,
        accentColor:     data.accent_color     || tenant.accentColor,
        heroTitle:       data.hero_title       || tenant.heroTitle,
        heroTitleAccent: data.hero_title_accent || tenant.heroTitleAccent,
        heroSubheadline: data.hero_subheadline || tenant.heroSubheadline,
        heroPrimaryCta:  data.hero_primary_cta || tenant.heroPrimaryCta,
        footerTagline:   data.footer_tagline   || tenant.footerTagline,
        statsEnrolled:   data.stats_enrolled   || tenant.statsEnrolled,
        statsRating:     data.stats_rating     || tenant.statsRating,
      };
    } catch {
      return tenant;
    }
  },
  ['tenant-settings'],
  { revalidate: 60, tags: ['tenant-settings'] },
);
