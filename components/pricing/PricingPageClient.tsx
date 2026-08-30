'use client';

/**
 * Page chrome for the public pricing page.
 *
 * The signed-in check happens here rather than on the server: the page is cached and served to
 * everyone, so baking a session into it would hand one visitor's state to the next. It only
 * decides which words the buttons carry, so resolving it in the browser costs nothing.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { PricingSection } from '@/components/pricing/PricingSection';
import { PricingFaq } from '@/components/pricing/PricingFaq';
import { PricingHero } from '@/components/pricing/PricingHero';
import { featuredOffer } from '@/lib/pricing-offer';
import type { PricingPageData } from '@/lib/pricing-contract';
import type { AdCard } from '@/lib/mid-ads';

export interface PricingPageClientProps extends PricingPageData {
  appName: string;
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  supportEmail?: string;
  midAds?: AdCard[];
}

export function PricingPageClient(props: PricingPageClientProps) {
  const { appName, logoUrl, primaryColor, accentColor, headingFont, bodyFont, supportEmail, midAds } = props;
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.session?.access_token);
    });
    return () => { cancelled = true; };
  }, []);

  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;

  return (
    <main className="min-h-screen" style={{ background: '#F7F8FA' }}>
      <header className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          {logoUrl
            ? <img src={logoUrl} alt={appName} className="h-8 w-auto object-contain" />
            : <span className="font-bold" style={{ fontFamily: hFont, color: '#101828' }}>{appName}</span>}
        </Link>
        <Link
          href={signedIn ? '/student' : '/auth'}
          className="text-sm font-bold"
          style={{ color: primaryColor }}
        >
          {signedIn ? 'My learning' : 'Sign in'}
        </Link>
      </header>

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-24">
        <PricingHero
          offer={featuredOffer(props.plans)}
          appName={appName}
          primaryColor={primaryColor}
          accentColor={accentColor}
          headingFont={headingFont}
          bodyFont={bodyFont}
          ctaHref={signedIn ? '/student#payments' : '/auth?mode=signup'}
          ctaLabel={signedIn ? 'Go to payment options' : 'Get started'}
        />

        <div className="text-center pt-12 pb-8">
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

      {/* The pricing page had no footer of its own, and a page that simply stops reads as
          unfinished. Slim and in the brand colour, matching how the landing templates close. */}
      <footer style={{ background: primaryColor }}>
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span className="text-sm font-bold" style={{ color: '#FFFFFF', fontFamily: hFont }}>{appName}</span>
          <div className="flex flex-wrap items-center gap-5 text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
            <Link href="/">Home</Link>
            <Link href={signedIn ? '/student' : '/auth'}>{signedIn ? 'My learning' : 'Sign in'}</Link>
            {supportEmail && <a href={`mailto:${supportEmail}`}>Contact us</a>}
          </div>
        </div>
      </footer>
    </main>
  );
}
