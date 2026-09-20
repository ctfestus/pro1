'use client';

/**
 * Page chrome and renderer for the public legal pages (privacy, terms).
 *
 * Both documents are the same shape, so they share one component and differ only in the data
 * handed to it -- see lib/legal-content.ts.
 *
 * The signed-in check happens here rather than on the server, for the same reason the pricing page
 * does it here: the page is cached and served to everyone, so baking a session into it would hand
 * one visitor's state to the next. It only decides which words the nav carries.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { LandingNav, LandingFooter } from '@/components/landing/LandingChrome';
import type { SiteConfig } from '@/lib/site-templates';
import type { LegalDocument } from '@/lib/legal-content';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { buildNavGroups } from '@/lib/landing-nav';
import { FONTS } from '@/lib/fonts';

function fontStylesheetUrl(fontName?: string): string | null {
  if (!fontName || fontName === 'Inter' || fontName === 'Google Sans Text') return null;
  const option = FONTS.find(font => font.name === fontName);
  return option?.googleFamily
    ? `https://fonts.googleapis.com/css2?family=${option.googleFamily}&display=swap`
    : null;
}

/** Stable anchor for a heading, so the contents list can link to its section. */
function slugify(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export interface LegalPageClientProps {
  document: LegalDocument;
  /** The resolved site settings, so the shared chrome renders exactly as it does on the landing page. */
  siteConfig: Partial<SiteConfig>;
  primaryColor: string;
  accentColor: string;
  headingFont?: string;
  bodyFont?: string;
  /** Only for the shared nav's Learn menu, so it matches the landing page's. */
  programmes: ProgrammeItem[];
}

export function LegalPageClient({
  document: doc, siteConfig, primaryColor, accentColor, headingFont, bodyFont, programmes,
}: LegalPageClientProps) {
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);

  // Same builder the landing page uses. Its section anchors do not exist here, which is what
  // navLinkHref is for: they become links home instead of scroll targets.
  const navGroups = useMemo(() => buildNavGroups(programmes, user), [programmes, user]);
  const sections = useMemo(
    () => doc.sections.map(section => ({ ...section, id: slugify(section.heading) })),
    [doc.sections],
  );

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUser(data.session?.user ?? null);
    });
    return () => { cancelled = true; };
  }, []);

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

      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 pt-10 pb-20 sm:pt-14">
        <header>
          <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: accentColor }}>
            Legal
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-4xl"
            style={{ color: '#101828', fontFamily: hFont, textWrap: 'balance' }}>
            {doc.title}
          </h1>
          <p className="mt-3 text-sm leading-6" style={{ color: '#475467' }}>{doc.summary}</p>
          <p className="mt-2 text-xs" style={{ color: '#98A2B3' }}>Last updated {doc.lastUpdated}</p>
        </header>

        <div className="mt-8 rounded-[22px] bg-white px-5 py-6 sm:px-8 sm:py-8">
          {doc.intro.map((paragraph, index) => (
            <p key={index} className="text-[15px] leading-7" style={{ color: '#344054', marginTop: index ? '0.9rem' : 0 }}>
              {paragraph}
            </p>
          ))}

          <nav className="mt-7 pt-6" style={{ borderTop: '1px solid #EAECF0' }} aria-label="Contents">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#98A2B3' }}>
              Contents
            </p>
            <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {sections.map((section, index) => (
                <li key={section.id} className="text-sm leading-6">
                  <a href={`#${section.id}`} className="transition-colors" style={{ color: '#475467' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = primaryColor; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#475467'; }}>
                    {index + 1}. {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="mt-9 scroll-mt-24">
              <h2 className="text-lg font-black tracking-[-0.02em]" style={{ color: '#101828', fontFamily: hFont }}>
                {index + 1}. {section.heading}
              </h2>
              {section.body.map((block, blockIndex) => (
                Array.isArray(block) ? (
                  <ul key={blockIndex} className="mt-3 flex flex-col gap-2">
                    {block.map(item => (
                      <li key={item} className="relative pl-5 text-[15px] leading-7" style={{ color: '#344054' }}>
                        <span aria-hidden="true" className="absolute left-0 top-[11px] h-1.5 w-1.5 rounded-full"
                          style={{ background: accentColor }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={blockIndex} className="mt-3 text-[15px] leading-7" style={{ color: '#344054' }}>
                    {block}
                  </p>
                )
              ))}
            </section>
          ))}
        </div>
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
    </main>
  );
}
