/**
 * The public landing page's settings: what Site settings edits and what the landing, pricing,
 * store, events and legal pages read.
 *
 * There is one template, Modern. The saved row still carries a template id, so ids from retired
 * templates resolve to it, and keys they saved are simply ignored.
 *
 * Defaults are what a tenant sees before editing anything, so they must stay neutral: no tenant
 * name, region, headcount, rating or free-tier promise a given tenant may not offer.
 */

export type SiteConfig = {
  // Colours
  primaryColor:    string;
  accentColor:     string;
  // Learning path cards: the button colour; the card body is a pale tint of it
  pathCardColor:   string;
  // Typography
  headingFont:     string;
  bodyFont:        string;
  // Headline: the page's H1 for screen readers, the browser title and the link preview image.
  heroTitle:       string;
  heroTitleAccent: string;
  // Picture beside the pricing page's tools list, set under Pricing Page in Site settings
  heroImageUrl:    string;
  // Closing call to action ('1' = hidden)
  ctaHeading:       string;
  ctaHeadingAccent: string;
  ctaSubtext:       string;
  ctaButton:        string;
  hideCta:          string;
  // Footer
  footerTagline:      string;
  footerLinksHeading: string;
  footerLink1Label: string; footerLink1Url: string;
  footerLink2Label: string; footerLink2Url: string;
  footerLink3Label: string; footerLink3Url: string;
  footerLink4Label: string; footerLink4Url: string;
  // Ad banner cards at the top of the page
  ad1Label: string; ad1Title: string; ad1Description: string; ad1CtaText: string; ad1CtaUrl: string; ad1BgColor: string; ad1BgImage: string;
  ad2Label: string; ad2Title: string; ad2Description: string; ad2CtaText: string; ad2CtaUrl: string; ad2BgColor: string; ad2BgImage: string;
  ad3Label: string; ad3Title: string; ad3Description: string; ad3CtaText: string; ad3CtaUrl: string; ad3BgColor: string; ad3BgImage: string;
  hideAdBanner: string;
  // Mid-page ad banner cards (between Learning Paths and Virtual Experiences)
  midAd1Label: string; midAd1Title: string; midAd1Description: string; midAd1CtaText: string; midAd1CtaUrl: string; midAd1BgColor: string; midAd1BgImage: string;
  midAd2Label: string; midAd2Title: string; midAd2Description: string; midAd2CtaText: string; midAd2CtaUrl: string; midAd2BgColor: string; midAd2BgImage: string;
  hideMidAdBanner: string;
  // Ad card image layout ('' = full-cover background, 'side' = image beside bg colour: right on desktop, bottom on mobile)
  ad1ImageLayout: string; ad2ImageLayout: string; ad3ImageLayout: string;
  midAd1ImageLayout: string; midAd2ImageLayout: string;
  // Per-card visibility ('1' = hidden). Hiding keeps the card's content so it can come back as it was.
  hideAd1: string; hideAd2: string; hideAd3: string;
  hideMidAd1: string; hideMidAd2: string;
  // Top ad banner full-width hero mode ('1' = edge-to-edge image banner with white text panel)
  adBannerFullWidth: string;
  // Dark mode ('1' = dark, '' = light)
  siteDarkMode: string;
};

export const SITE_DEFAULTS: SiteConfig = {
  primaryColor: '#0056D2',
  accentColor:  '#FF9933',
  // The platform blue, as on primary buttons in the app.
  pathCardColor: '#3E93FF',
  headingFont:  'Inter',
  bodyFont:     'Inter',
  // Empty means the platform name stands in.
  heroTitle:       '',
  heroTitleAccent: '',
  heroImageUrl:    '',
  ctaHeading:       'Start with one course.',
  ctaHeadingAccent: 'Build from there.',
  ctaSubtext:       'Create an account to save your progress, collect credentials and pick up where you left off.',
  ctaButton:        'Create free account',
  hideCta:          '',
  footerTagline:      '',
  footerLinksHeading: 'Learn',
  // Section anchors on the home page, so they also work from the pricing, store and legal pages.
  footerLink1Label: 'Courses',             footerLink1Url: '/courses',
  footerLink2Label: 'Learning paths',      footerLink2Url: '/learning-paths',
  footerLink3Label: 'Virtual experiences', footerLink3Url: '/virtual-experiences',
  footerLink4Label: 'Certifications',      footerLink4Url: '/certifications',
  ad1Label: 'New', ad1Title: 'Start your learning journey', ad1Description: 'Courses, learning paths and virtual experiences in one place.', ad1CtaText: 'Browse courses', ad1CtaUrl: '/#section-courses', ad1BgColor: '#0056D2', ad1BgImage: '',
  ad2Label: 'Featured', ad2Title: 'Build job-ready skills with virtual experiences', ad2Description: 'Work through real business scenarios and add the results to your portfolio.', ad2CtaText: 'Explore experiences', ad2CtaUrl: '/#section-ves', ad2BgColor: '#003262', ad2BgImage: '',
  ad3Label: 'Popular', ad3Title: 'Guided learning paths for your career goals', ad3Description: 'Curated courses and projects that take you from beginner to job-ready.', ad3CtaText: 'View learning paths', ad3CtaUrl: '/#section-paths', ad3BgColor: '#064E3B', ad3BgImage: '',
  hideAdBanner: '',
  midAd1Label: 'Trending', midAd1Title: 'Enrol in a guided learning path', midAd1Description: 'Follow a curated sequence of courses and projects designed to take you from beginner to job-ready.', midAd1CtaText: 'Browse paths', midAd1CtaUrl: '/#section-paths', midAd1BgColor: '#0056D2', midAd1BgImage: '',
  midAd2Label: 'New', midAd2Title: 'Start your first course today', midAd2Description: 'Pick a course, learn at your own pace and pick up where you left off.', midAd2CtaText: 'Browse courses', midAd2CtaUrl: '/#section-courses', midAd2BgColor: '#064E3B', midAd2BgImage: '',
  hideMidAdBanner: '',
  ad1ImageLayout: '', ad2ImageLayout: '', ad3ImageLayout: '', midAd1ImageLayout: '', midAd2ImageLayout: '',
  hideAd1: '', hideAd2: '', hideAd3: '', hideMidAd1: '', hideMidAd2: '',
  adBannerFullWidth: '',
  siteDarkMode: '',
};

/** Merge saved config over the defaults so missing keys always have a value. */
export function resolveConfig(saved: Partial<SiteConfig>): SiteConfig {
  return { ...SITE_DEFAULTS, ...saved };
}
