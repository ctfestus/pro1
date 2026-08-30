'use client';

/**
 * Page chrome for the public pricing page.
 *
 * The signed-in check happens here rather than on the server: the page is cached and served to
 * everyone, so baking a session into it would hand one visitor's state to the next. It only
 * decides which words the buttons carry, so resolving it in the browser costs nothing.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { LandingNav, LandingFooter } from '@/components/landing/LandingChrome';
import type { SiteConfig } from '@/lib/site-templates';
import { PricingSection } from '@/components/pricing/PricingSection';
import { PricingFaq } from '@/components/pricing/PricingFaq';
import { PricingHero } from '@/components/pricing/PricingHero';
import { featuredOffer } from '@/lib/pricing-offer';
import type { PricingPageData } from '@/lib/pricing-contract';
import type { AdCard } from '@/lib/mid-ads';

export interface PricingPageClientProps extends PricingPageData {
  /** The resolved site settings, so the shared chrome renders exactly as it does on the landing page. */
  siteConfig: Partial<SiteConfig>;
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  supportEmail?: string;
  midAds?: AdCard[];
}

export function PricingPageClient(props: PricingPageClientProps) {
  const { siteConfig, primaryColor, accentColor, headingFont, bodyFont, supportEmail, midAds } = props;
  // The same source the landing page reads, so the chrome cannot say one thing here and another
  // there.
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const signedIn = !!user;

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUser(data.session?.user ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  // The nav shows a shadow once the page moves, exactly as it does on the landing page.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;

  return (
    <main className="min-h-screen pt-16" style={{ background: '#F7F8FA' }}>
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
        navLinks={[
          { label: 'Courses', anchor: 'section-courses' },
          { label: 'Learning Paths', anchor: 'section-paths' },
          { label: 'Virtual Experiences', anchor: 'section-ves' },
        ]}
        navLinkHref={anchor => `/#${anchor}`}
      />

      <PricingHero
        offer={featuredOffer(props.plans)}
        primaryColor={primaryColor}
        accentColor={accentColor}
        headingFont={headingFont}
        bodyFont={bodyFont}
        ctaHref={signedIn ? '/student#payments' : '/auth?mode=signup'}
        ctaLabel={signedIn ? 'Go to payment options' : 'Get started'}
      />

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-24">
        <div className="text-center pt-14 pb-8">
          <h2
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: hFont, color: '#101828', textWrap: 'balance' }}
          >
            Choose how long you want access
          </h2>
          <p className="mt-3 text-base max-w-2xl mx-auto" style={{ color: '#475467' }}>
            Start free. Upgrade when you want the full catalogue, and pay only for the time you use.
          </p>
        </div>

        <PricingSection
          plans={props.plans}
          free={props.free}
          primaryColor={primaryColor}
          accentColor={accentColor}
          headingFont={headingFont}
          bodyFont={bodyFont}
          signedIn={signedIn}
          supportEmail={supportEmail}
          midAds={midAds}
        />

        <PricingFaq
          headingFont={headingFont}
          primaryColor={primaryColor}
          supportEmail={supportEmail}
          paidPlanName={props.plans.length === 1 ? props.plans[0].name : undefined}
        />
      </div>

      <LandingFooter
        appName={appName}
        primaryColor={primaryColor}
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
