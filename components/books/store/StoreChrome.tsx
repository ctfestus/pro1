'use client';

/**
 * Page chrome for the public book store (/books, /books/[slug]): the same nav and footer as the
 * landing and pricing pages, so the store reads as part of the site. Like the pricing page, the
 * signed-in check happens in the browser: these pages are cached and served to everyone, so a
 * session must never be baked into them.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { LandingNav, LandingFooter } from '@/components/landing/LandingChrome';
import { buildNavGroups, type NavBook } from '@/lib/landing-nav';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import type { SiteConfig } from '@/lib/site-templates';

export interface StoreChromeProps {
  siteConfig: Partial<SiteConfig>;
  primaryColor: string;
  accentColor: string;
  bodyFont?: string;
  programmes: ProgrammeItem[];
  navBooks: NavBook[];
  children: React.ReactNode;
}

export function StoreChrome({ siteConfig, primaryColor, accentColor, bodyFont, programmes, navBooks, children }: StoreChromeProps) {
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const navGroups = useMemo(() => buildNavGroups(programmes, user, navBooks), [programmes, user, navBooks]);
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => { if (!cancelled) setUser(data.session?.user ?? null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <main className="min-h-screen pt-16" style={{ background: '#F3F6F5', fontFamily: bFont }}>
      <LandingNav
        appName={appName}
        logoUrl={logoUrl}
        logoDarkUrl={logoDarkUrl}
        scrolled={scrolled}
        user={user}
        profile={null}
        publicSignupEnabled={publicSignupEnabled}
        primaryColor={primaryColor}
        accentColor={accentColor}
        fontFamily={bFont}
        navLinks={navGroups}
        navMenuLabel="Learn"
        navLinkHref={anchor => `/#${anchor}`}
      />
      {children}
      <LandingFooter
        appName={appName}
        primaryColor={primaryColor}
        fontFamily={bFont}
        user={user}
        footerTagline={siteConfig.footerTagline}
        footerLinksHeading={siteConfig.footerLinksHeading}
        footerLink1Label={siteConfig.footerLink1Label} footerLink1Url={siteConfig.footerLink1Url}
        footerLink2Label={siteConfig.footerLink2Label} footerLink2Url={siteConfig.footerLink2Url}
        footerLink3Label={siteConfig.footerLink3Label} footerLink3Url={siteConfig.footerLink3Url}
        footerLink4Label={siteConfig.footerLink4Label} footerLink4Url={siteConfig.footerLink4Url}
      />
    </main>
  );
}
