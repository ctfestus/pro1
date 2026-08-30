/**
 * The mid-page promotional cards an admin configured, read from site settings.
 *
 * Plain functions in a plain module, deliberately not in the component file. That file is a
 * client component, and every export of a 'use client' module becomes a client reference when a
 * server component imports it -- so a server page calling one of these from there would be
 * calling a reference, not a function, and the page throws before it renders.
 */
import type { SiteConfig } from '@/lib/site-templates';

export type AdCard = {
  label: string;
  title: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  bgColor: string;
  bgImage: string;
  imageLayout?: string;
};

/** The two mid-page cards, in the order they are shown. */
export function midAdCardsFrom(config: Partial<SiteConfig>): AdCard[] {
  return [
    {
      label: config.midAd1Label ?? '', title: config.midAd1Title ?? '',
      description: config.midAd1Description ?? '', ctaText: config.midAd1CtaText ?? '',
      ctaUrl: config.midAd1CtaUrl ?? '', bgColor: config.midAd1BgColor ?? '',
      bgImage: config.midAd1BgImage ?? '', imageLayout: config.midAd1ImageLayout ?? '',
    },
    {
      label: config.midAd2Label ?? '', title: config.midAd2Title ?? '',
      description: config.midAd2Description ?? '', ctaText: config.midAd2CtaText ?? '',
      ctaUrl: config.midAd2CtaUrl ?? '', bgColor: config.midAd2BgColor ?? '',
      bgImage: config.midAd2BgImage ?? '', imageLayout: config.midAd2ImageLayout ?? '',
    },
  ];
}

/** True when an admin has actually set these up and not switched them off. */
export function hasMidAds(config: Partial<SiteConfig>): boolean {
  return config.hideMidAdBanner !== '1' && midAdCardsFrom(config).some(ad => ad.title);
}
