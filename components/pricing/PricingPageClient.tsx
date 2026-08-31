'use client';

/**
 * Page chrome for the public pricing page.
 *
 * The signed-in check happens here rather than on the server: the page is cached and served to
 * everyone, so baking a session into it would hand one visitor's state to the next. It only
 * decides which words the buttons carry, so resolving it in the browser costs nothing.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { LandingNav, LandingFooter } from '@/components/landing/LandingChrome';
import type { SiteConfig } from '@/lib/site-templates';
import { PricingSection } from '@/components/pricing/PricingSection';
import { PricingFaq } from '@/components/pricing/PricingFaq';
import { PricingHero } from '@/components/pricing/PricingHero';
import { featuredOffer, featuredOfferForDuration } from '@/lib/pricing-offer';
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
  /** Whether a card checkout can be opened straight from this page. */
  paystackEnabled: boolean;
}

export function PricingPageClient(props: PricingPageClientProps) {
  const { siteConfig, primaryColor, accentColor, headingFont, bodyFont, supportEmail, midAds,
    paystackEnabled } = props;
  // The same source the landing page reads, so the chrome cannot say one thing here and another
  // there.
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const signedIn = !!user;

  const durations = useMemo(() => {
    const all = new Set<number>();
    props.plans.forEach(plan => plan.prices.forEach(price => all.add(price.durationMonths)));
    return [...all].sort((a, b) => a - b);
  }, [props.plans]);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(() =>
    featuredOffer(props.plans)?.price.durationMonths ?? durations[durations.length - 1] ?? null,
  );
  const selectedOffer = useMemo(
    () => featuredOfferForDuration(props.plans, selectedDuration),
    [props.plans, selectedDuration],
  );

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
  const finalCtaHref = signedIn ? '/student#payments' : '/auth?mode=signup';

  return (
    <main className="min-h-screen pt-16" style={{ background: '#F3F6F5' }}>
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
        offer={selectedOffer}
        primaryColor={primaryColor}
        accentColor={accentColor}
        headingFont={headingFont}
        bodyFont={bodyFont}
      />

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-24">
        <PricingSection
          plans={props.plans}
          free={props.free}
          primaryColor={primaryColor}
          accentColor={accentColor}
          headingFont={headingFont}
          bodyFont={bodyFont}
          signedIn={signedIn}
          paystackEnabled={paystackEnabled}
          supportEmail={supportEmail}
          midAds={midAds}
          durations={durations}
          selectedDuration={selectedDuration}
          onSelectDuration={setSelectedDuration}
        />

        <PricingFaq
          headingFont={headingFont}
          primaryColor={primaryColor}
          supportEmail={supportEmail}
          paidPlanName={props.plans.length === 1 ? props.plans[0].name : undefined}
        />

        <section className="relative mt-16 overflow-hidden rounded-[30px] px-6 py-10 text-center sm:px-10 sm:py-12" style={{ background: primaryColor }}>
          <div aria-hidden="true" className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-28 -right-10 h-72 w-72 rounded-full blur-3xl" style={{ background: `color-mix(in srgb, ${accentColor} 32%, transparent)` }} />
          <div className="relative">
            <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.66)' }}>Ready when you are</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-black tracking-[-0.035em] sm:text-4xl" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance' }}>
              Start free, then unlock more when your ambition asks for it.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6" style={{ color: 'rgba(255,255,255,0.72)' }}>
              No card to begin. No automatic renewal. Just clear access to the experience you choose.
            </p>
            <Link href={finalCtaHref} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black" style={{ color: '#101828' }}>
              {signedIn ? 'View payment options' : 'Create your free account'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
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
