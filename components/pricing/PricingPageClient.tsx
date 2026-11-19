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
import { PromoCard } from '@/components/PromoCard';
import type { SiteConfig } from '@/lib/site-templates';
import { PricingSection } from '@/components/pricing/PricingSection';
import { PricingFaq } from '@/components/pricing/PricingFaq';
import { PricingHero } from '@/components/pricing/PricingHero';
import { featuredOffer, featuredOfferForDuration } from '@/lib/pricing-offer';
import type { PricingPageData } from '@/lib/pricing-contract';
import type { AdCard } from '@/lib/mid-ads';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { buildNavGroups, type NavBook } from '@/lib/landing-nav';
import { FONTS } from '@/lib/fonts';

function fontStylesheetUrl(fontName?: string): string | null {
  if (!fontName || fontName === 'Inter' || fontName === 'Google Sans Text') return null;
  const option = FONTS.find(font => font.name === fontName);
  return option?.googleFamily
    ? `https://fonts.googleapis.com/css2?family=${option.googleFamily}&display=swap`
    : null;
}

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
  /** Only for the shared nav's Learn menu, so it matches the landing page's. */
  programmes: ProgrammeItem[];
  /** The store's books, for the Learn menu's Books entry. */
  navBooks?: NavBook[];
  navEvents?: NavBook[];
}

/** The catalogue's item types, as the purchase records name their tables. */
const CONTENT_TABLE: Record<string, string> = {
  course: 'courses', virtual_experience: 'virtual_experiences', learning_path: 'learning_paths', certification: 'certifications',
};

export function PricingPageClient(props: PricingPageClientProps) {
  const { siteConfig, primaryColor, accentColor, headingFont, bodyFont, supportEmail, midAds,
    paystackEnabled, programmes, navBooks, navEvents } = props;
  // The same source the landing page reads, so the chrome cannot say one thing here and another
  // there.
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const signedIn = !!user;

  // Same builder the landing page uses. Its section anchors do not exist here, which is what
  // navLinkHref is for: they become links home instead of scroll targets.
  const navGroups = useMemo(() => buildNavGroups(programmes, user, navBooks, navEvents), [programmes, user, navBooks, navEvents]);

  // Arrived from a locked item (?ref=&type=, see pricingHrefFor): show only the plans that open
  // it, and say so. The item's public preview already names those plans, so this asks it rather
  // than the server, and the page itself stays cached for everyone.
  const [forItem, setForItem] = useState<{ title: string; contentTable: string; contentId: string; planIds: Set<string> } | null>(null);
  const plans = useMemo(
    () => (forItem ? props.plans.filter(plan => forItem.planIds.has(plan.id)) : props.plans),
    [forItem, props.plans],
  );
  const showAllPlans = () => {
    setForItem(null);
    window.history.replaceState(null, '', '/pricing');
  };

  const durations = useMemo(() => {
    const all = new Set<number>();
    plans.forEach(plan => plan.prices.forEach(price => all.add(price.durationMonths)));
    return [...all].sort((a, b) => a - b);
  }, [plans]);
  const defaultOffer = useMemo(() => featuredOffer(plans), [plans]);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(() =>
    defaultOffer?.price.durationMonths ?? durations[durations.length - 1] ?? null,
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    const type = params.get('type');
    if (!ref || !type) return;
    let cancelled = false;
    fetch(`/api/catalogue-preview?ref=${encodeURIComponent(ref)}&type=${encodeURIComponent(type)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        const planIds = new Set<string>((json?.item?.unlock?.plans ?? []).map((plan: any) => plan.id));
        const itemPlans = props.plans.filter(plan => planIds.has(plan.id));
        if (cancelled || !json?.item?.title || !itemPlans.length) return;
        setForItem({ title: json.item.title, contentTable: CONTENT_TABLE[json.item.type] ?? '', contentId: json.item.id, planIds });
        // Start on a length these plans sell, the same pick the page makes for all plans.
        setSelectedDuration(featuredOffer(itemPlans)?.price.durationMonths ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [props.plans]);
  const billingDurationOptions = useMemo(() => {
    const planDurations = defaultOffer
      ? [...new Set(defaultOffer.plan.prices.map(price => price.durationMonths))].sort((a, b) => a - b)
      : durations;
    const shortDuration = planDurations[0];
    if (shortDuration === undefined) return [];
    const featuredDuration = defaultOffer?.price.durationMonths ?? planDurations[planDurations.length - 1];
    const longDuration = featuredDuration === shortDuration
      ? planDurations[planDurations.length - 1]
      : featuredDuration;
    return longDuration === shortDuration ? [shortDuration] : [shortDuration, longDuration];
  }, [defaultOffer, durations]);
  const selectedOffer = useMemo(
    () => featuredOfferForDuration(plans, selectedDuration),
    [plans, selectedDuration],
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
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  const fontStylesheets = [...new Set([
    fontStylesheetUrl(headingFont),
    fontStylesheetUrl(bodyFont),
  ].filter((url): url is string => !!url))];
  const finalCtaHref = signedIn ? '/student#payments' : '/auth?mode=signup';

  return (
    <main className="min-h-screen pt-16" style={{ background: '#F3F6F5', fontFamily: bFont }}>
      {fontStylesheets.map(url => <link key={url} rel="stylesheet" href={url} />)}
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

      <PricingHero
        offer={selectedOffer}
        primaryColor={primaryColor}
        accentColor={accentColor}
        headingFont={headingFont}
        bodyFont={bodyFont}
      />

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-24">
        <PricingSection
          plans={plans}
          free={props.free}
          primaryColor={primaryColor}
          accentColor={accentColor}
          headingFont={headingFont}
          bodyFont={bodyFont}
          signedIn={signedIn}
          paystackEnabled={paystackEnabled}
          midAds={midAds}
          durationOptions={billingDurationOptions}
          selectedDuration={selectedDuration}
          onSelectDuration={setSelectedDuration}
          forItem={forItem && { title: forItem.title, contentTable: forItem.contentTable, contentId: forItem.contentId, onShowAll: showAllPlans }}
        />

        <PricingFaq
          headingFont={headingFont}
          bodyFont={bodyFont}
          supportEmail={supportEmail}
          paidPlanName={plans.length === 1 ? plans[0].name : undefined}
        />

        <section className="relative mt-16 overflow-hidden rounded-[30px] px-6 py-10 text-center sm:px-10 sm:py-12" style={{ background: primaryColor }}>
          <div aria-hidden="true" className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-28 -right-10 h-72 w-72 rounded-full blur-3xl" style={{ background: `color-mix(in srgb, ${accentColor} 32%, transparent)` }} />
          <div className="relative">
            <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.66)' }}>Ready when you are</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-[28px] leading-9 font-black tracking-[-0.035em] sm:text-4xl sm:leading-[44px]" style={{ color: '#FFFFFF', fontFamily: hFont, textWrap: 'balance' }}>
              Start free, then unlock more when your ambition asks for it.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6" style={{ color: 'rgba(255,255,255,0.72)' }}>
              No card to begin. No automatic renewal. Just clear access to the experience you choose.
            </p>
            <Link href={finalCtaHref} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black" style={{ color: '#101828', fontFamily: hFont }}>
              {signedIn ? 'View payment options' : 'Create your free account'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>

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
      <PromoCard placement="landing" light />
    </main>
  );
}
