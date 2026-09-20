'use client';

/**
 * Page chrome and renderer for the public legal pages (privacy, terms).
 *
 * Both documents are the same shape, so they share one component and differ only in the data
 * handed to it -- see lib/legal-content.ts.
 *
 * Laid out as documentation rather than as a single slab of text: a contents rail that tracks
 * where you are, and a body held to a readable measure. A privacy policy is 19 sections and the
 * terms are 26, so without a persistent way to move around them, the only way to find one clause
 * is to scroll past the other twenty-five.
 *
 * Unlike the landing and pricing pages, which are light whatever the reader has chosen, these
 * follow the app theme: they are read end to end rather than skimmed, and a wall of body text is
 * the worst thing to serve at full brightness to someone who asked for dark.
 *
 * The signed-in check happens here rather than on the server, for the same reason the pricing page
 * does it here: the page is cached and served to everyone, so baking a session into it would hand
 * one visitor's state to the next. It only decides which words the nav carries.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { useTheme } from '@/components/ThemeProvider';
import { useC } from '@/lib/theme';
import { LandingNav, LandingFooter } from '@/components/landing/LandingChrome';
import type { SiteConfig } from '@/lib/site-templates';
import type { LegalDocument } from '@/lib/legal-content';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { buildNavGroups } from '@/lib/landing-nav';
import { FONTS } from '@/lib/fonts';

/**
 * These documents get saved and printed, so they get a print stylesheet. Nav, contents rail and
 * footer are screen furniture and come off the page; the body goes black on white whichever theme
 * the reader is in, and sections stop breaking across a page boundary mid-clause.
 */
const PRINT_CSS = `
@media print {
  .legal-screen-only { display: none !important; }
  .legal-page { background: #fff !important; padding-top: 0 !important; }
  .legal-body { max-width: none !important; }
  .legal-section { break-inside: avoid; border-color: #ddd !important; }
  .legal-page h1, .legal-page h2, .legal-page p, .legal-page li { color: #000 !important; }
}
@media (prefers-reduced-motion: no-preference) {
  .legal-page { scroll-behavior: smooth; }
  .legal-contents-chevron { transition: transform 180ms ease; }
}
details[open] .legal-contents-chevron { transform: rotate(180deg); }
`;

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
  doc: LegalDocument;
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
  doc, siteConfig, primaryColor, accentColor, headingFont, bodyFont, programmes,
}: LegalPageClientProps) {
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();
  const { theme } = useTheme();
  const C = useC();
  const dark = theme === 'dark';
  const [user, setUser] = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState('');

  // White in light, the app's dark surface in dark. Not C.page in light: that is the slightly
  // grey app background, and a document reads better on the paper colour than on the desk.
  const pageBg = dark ? C.page : '#FFFFFF';
  const railIdle = dark ? C.faint : '#667085';
  // DARK_C.text (#ACB8C5) and DARK_C.muted (#A8B5C2) sit within a few points of each other. That
  // is fine for chrome, where weight and position carry the hierarchy, and wrong for a document,
  // where a heading and the paragraph under it come out the same grey and the structure vanishes.
  // Headings get a brighter ink in dark; in light C.text is already near-black.
  const heading = dark ? '#E8EEF5' : C.text;

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

  // Which clause you are reading: the last one whose heading has passed under the nav.
  //
  // Measured from scroll position rather than with an IntersectionObserver band. A band wide
  // enough to catch a short section also still contains the tail of the previous one, and since
  // that one comes first in the document it keeps winning -- the rail then sits a section behind
  // what is actually on screen. Comparing heading positions has no such ambiguity. Reads are
  // batched into one frame, and 26 getBoundingClientRect calls at that rate cost nothing.
  useEffect(() => {
    const elements = sections
      .map(section => ({ id: section.id, el: document.getElementById(section.id) }))
      .filter((entry): entry is { id: string; el: HTMLElement } => !!entry.el);
    if (!elements.length) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = elements[0].id;
      for (const { id, el } of elements) {
        if (el.getBoundingClientRect().top > 120) break;
        current = id;
      }
      setActiveId(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont ? `'${bodyFont}', sans-serif` : undefined;
  const fontStylesheets = [...new Set([
    fontStylesheetUrl(headingFont),
    fontStylesheetUrl(bodyFont),
  ].filter((url): url is string => !!url))];

  const contentsLinks = sections.map(section => {
    const active = section.id === activeId;
    return (
      <li key={section.id}>
        <a
          href={`#${section.id}`}
          aria-current={active ? 'true' : undefined}
          className="-ml-px block border-l-2 py-[7px] pl-4 text-[13px] leading-snug transition-colors"
          style={{
            borderColor: active ? C.cta : 'transparent',
            color: active ? heading : railIdle,
            fontWeight: active ? 700 : 500,
          }}
        >
          {section.heading}
        </a>
      </li>
    );
  });

  return (
    <main className="legal-page min-h-screen pt-16" style={{ background: pageBg, fontFamily: bFont }}>
      <style>{PRINT_CSS}</style>
      {fontStylesheets.map(url => <link key={url} rel="stylesheet" href={url} />)}

      <div className="legal-screen-only">
        <LandingNav
          appName={appName}
          logoUrl={logoUrl}
          logoDarkUrl={logoDarkUrl}
          isPageDark={dark}
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
      </div>

      <div className="mx-auto w-full max-w-[1100px] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
        <header className="max-w-[46ch]">
          <h1
            className="text-[34px] font-black leading-[1.05] tracking-[-0.04em] sm:text-5xl"
            style={{ color: heading, fontFamily: hFont, textWrap: 'balance' }}
          >
            {doc.title}
          </h1>
          <p className="mt-4 text-[17px] leading-7" style={{ color: C.muted }}>{doc.summary}</p>
          <p className="mt-5 text-xs" style={{ color: C.faint }}>Updated {doc.lastUpdated}</p>
        </header>

        <div className="mt-10 h-px sm:mt-12" style={{ background: C.divider }} />

        <div className="mt-8 gap-12 lg:grid lg:grid-cols-[228px_minmax(0,1fr)] lg:items-start">
          {/* Contents. A rail on wide screens, a disclosure on phones, where 26 permanent links
              would push the document itself below the fold. */}
          <nav aria-label="Contents" className="legal-screen-only lg:sticky lg:top-24">
            <details className="lg:hidden" name="legal-contents">
              <summary
                className="flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-sm font-bold marker:content-none"
                style={{ background: C.card, color: heading }}
              >
                Contents ({sections.length} sections)
                <ChevronDown className="legal-contents-chevron h-4 w-4" style={{ color: C.faint }} aria-hidden="true" />
              </summary>
              <ol className="mt-2 rounded-xl py-2 pl-4 pr-3" style={{ background: C.card }}>{contentsLinks}</ol>
            </details>

            <div className="hidden lg:block">
              <p className="text-[13px] font-bold" style={{ color: heading }}>Contents</p>
              <ol
                className="mt-3 max-h-[calc(100vh-11rem)] overflow-y-auto border-l pl-0"
                style={{ borderColor: C.divider }}
              >
                {contentsLinks}
              </ol>
            </div>
          </nav>

          <article className="legal-body mt-10 max-w-[68ch] lg:mt-0">
            {doc.intro.map((paragraph, index) => (
              <p
                key={index}
                className="text-[17px] leading-[1.7]"
                style={{ color: C.muted, marginTop: index ? '1rem' : 0 }}
              >
                {paragraph}
              </p>
            ))}

            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="legal-section mt-10 scroll-mt-28 pt-10"
                style={{ borderTop: `1px solid ${C.divider}` }}
              >
                <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                  <span aria-hidden="true" className="pt-[3px] text-sm font-bold" style={{ color: C.faint, opacity: 0.55 }}>
                    {index + 1}
                  </span>
                  <div>
                    <h2
                      className="text-[19px] font-black tracking-[-0.02em] sm:text-xl"
                      style={{ color: heading, fontFamily: hFont }}
                    >
                      {section.heading}
                    </h2>
                    {section.body.map((block, blockIndex) => (
                      Array.isArray(block) ? (
                        <ul key={blockIndex} className="mt-4 flex flex-col gap-2.5">
                          {block.map(item => (
                            <li
                              key={item}
                              className="relative pl-5 text-[15.5px] leading-[1.75]"
                              style={{ color: C.muted }}
                            >
                              <span
                                aria-hidden="true"
                                className="absolute left-0 top-[11px] h-1.5 w-1.5 rounded-full"
                                style={{ background: C.faint, opacity: 0.55 }}
                              />
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p key={blockIndex} className="mt-4 text-[15.5px] leading-[1.75]" style={{ color: C.muted }}>
                          {block}
                        </p>
                      )
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </article>
        </div>
      </div>

      <div className="legal-screen-only">
        <LandingFooter
          appName={appName}
          isPageDark={dark}
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
      </div>
    </main>
  );
}
