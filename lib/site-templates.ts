/**
 * Site template registry.
 *
 * To add a new template:
 *  1. Add an entry to TEMPLATES with its id, label, and default config.
 *  2. Create the landing page component (receives SiteConfig as props).
 *  3. Register it in app/page.tsx template switch.
 */

export type SiteConfig = {
  // Colours
  primaryColor:    string;
  accentColor:     string;
  // Typography
  headingFont:     string;
  bodyFont:        string;
  // Hero
  heroTitle:       string;
  heroTitleAccent: string;
  heroSubheadline: string;
  heroPrimaryCta:  string;
  heroImageUrl:    string;
  heroFontSize:       string;  // desktop font size in px (mobile scales proportionally)
  heroOverlayColor:   string;
  heroOverlayOpacity: string;  // 0-100
  statsEnrolled:   string;
  statsRating:     string;
  // Offerings section (Momentum)
  offeringsLabel:          string;
  offeringsHeading:        string;
  offeringsHeadingAccent:  string;
  offeringsSubtext:        string;
  offering1Title: string; offering1Description: string; offering1Badge: string;
  offering2Title: string; offering2Description: string; offering2Badge: string;
  offering3Title: string; offering3Description: string; offering3Badge: string;
  offering4Title: string; offering4Description: string; offering4Badge: string;
  // Steps section (Momentum)
  stepsLabel:          string;
  stepsHeading:        string;
  stepsHeadingAccent:  string;
  step1Title: string; step1Body: string;
  step2Title: string; step2Body: string;
  step3Title: string; step3Body: string;
  // Features section (Momentum)
  featuresLabel:         string;
  featuresHeading:       string;
  featuresHeadingAccent: string;
  featuresSubtext:       string;
  featuresCta:           string;
  highlight1: string; highlight2: string; highlight3: string; highlight4: string;
  highlight5: string; highlight6: string; highlight7: string; highlight8: string;
  // Testimonials
  testimonialsLabel:   string;
  testimonialsHeading: string;
  testimonial1Name: string; testimonial1Role: string; testimonial1Text: string;
  testimonial2Name: string; testimonial2Role: string; testimonial2Text: string;
  testimonial3Name: string; testimonial3Role: string; testimonial3Text: string;
  testimonialVideoUrl: string;
  // CTA banner
  ctaHeading:       string;
  ctaHeadingAccent: string;
  ctaSubtext:       string;
  ctaButton:        string;
  // Footer
  footerTagline: string;
  // Tracks/Programmes section (Elevate)
  tracksLabel:          string;
  tracksHeading:        string;
  tracksHeadingAccent:  string;
  track1Title: string; track1Description: string; track1ImageUrl: string; track1Badge: string;
  track2Title: string; track2Description: string; track2ImageUrl: string; track2Badge: string;
  track3Title: string; track3Description: string; track3ImageUrl: string; track3Badge: string;
  // Impact stats (Elevate)
  impactLabel: string;
  stat1Value: string; stat1Label: string; stat1ImageUrl: string;
  stat2Value: string; stat2Label: string; stat2ImageUrl: string;
  stat3Value: string; stat3Label: string; stat3ImageUrl: string;
  stat4Value: string; stat4Label: string; stat4ImageUrl: string;
  statImgOverlay: string;  // 0-100, darkness of image overlay on stat cards
  // Partners strip (Elevate)
  partnersLabel:   string;
  partner1Name: string; partner1LogoUrl: string;
  partner2Name: string; partner2LogoUrl: string;
  partner3Name: string; partner3LogoUrl: string;
  partner4Name: string; partner4LogoUrl: string;
  partner5Name: string; partner5LogoUrl: string;
  partner6Name: string; partner6LogoUrl: string;
  // Newsletter / CTA (Elevate)
  newsletterHeading: string;
  newsletterSubtext: string;
  newsletterButton:  string;
  // Section colours (Elevate)
  navBgColor:        string;
  navTextColor:      string;
  sectionDarkBg:     string;
  sectionLightBg:    string;
  sectionAltBg:      string;
  textHeadingColor:  string;  // text on light sections
  textBodyColor:     string;  // body text on light sections
  textMutedColor:    string;  // muted text on light sections
  textOnDarkColor:   string;  // heading/body on dark sections (stats, footer)
  textOnAltColor:    string;  // heading/body on alternate sections (testimonials, partners)
  cardBadgeBg:       string;  // programme card badge background
  cardBadgeText:     string;  // programme card badge text colour
  cardOverlayColor:  string;  // programme card image overlay colour
  cardOverlayOpacity: string; // programme card overlay opacity 0-100
  // Section visibility ('1' = hidden, '' = visible)
  hideOfferings:    string;
  hideSteps:        string;
  hideFeatures:     string;
  hideTestimonials: string;
  hideCta:          string;
  hidePartners:     string;
  hideStats:        string;
  // Sticky CTA bar
  stickyCtaText:   string;
  stickyCtaButton: string;
  hideStickyBar:   string;
  // Footer custom links
  footerLinksHeading: string;
  footerLink1Label: string; footerLink1Url: string;
  footerLink2Label: string; footerLink2Url: string;
  footerLink3Label: string; footerLink3Url: string;
  footerLink4Label: string; footerLink4Url: string;
  // Footer background image
  footerBgImageUrl:     string;
  footerOverlayColor:   string;
  footerOverlayOpacity: string;
  // Floating CTA card (overlaps footer)
  floatingCtaHeading:  string;
  floatingCtaSubtext:  string;
  floatingCtaButton:   string;
  floatingCtaImageUrl: string;
  floatingCtaBgColor:  string;
  hideFloatingCta:     string;
  // Ad banner cards (Modern template)
  ad1Label: string; ad1Title: string; ad1Description: string; ad1CtaText: string; ad1CtaUrl: string; ad1BgColor: string; ad1BgImage: string;
  ad2Label: string; ad2Title: string; ad2Description: string; ad2CtaText: string; ad2CtaUrl: string; ad2BgColor: string; ad2BgImage: string;
  ad3Label: string; ad3Title: string; ad3Description: string; ad3CtaText: string; ad3CtaUrl: string; ad3BgColor: string; ad3BgImage: string;
  hideAdBanner: string;
  // Mid-page ad banner cards (Modern template -- between Learning Paths and Virtual Experiences)
  midAd1Label: string; midAd1Title: string; midAd1Description: string; midAd1CtaText: string; midAd1CtaUrl: string; midAd1BgColor: string; midAd1BgImage: string;
  midAd2Label: string; midAd2Title: string; midAd2Description: string; midAd2CtaText: string; midAd2CtaUrl: string; midAd2BgColor: string; midAd2BgImage: string;
  hideMidAdBanner: string;
  // Ad card image layout ('' = full-cover background, 'side' = image beside bg colour: right on desktop, bottom on mobile)
  ad1ImageLayout: string; ad2ImageLayout: string; ad3ImageLayout: string;
  midAd1ImageLayout: string; midAd2ImageLayout: string;
  // Top ad banner full-width hero mode ('1' = edge-to-edge image banner with white text panel)
  adBannerFullWidth: string;
  // Dark mode (Modern template -- '1' = dark, '' = light)
  siteDarkMode: string;
};

export type Template = {
  id:       string;
  label:    string;
  defaults: SiteConfig;
};

const ELEVATE_EMPTY = {
  tracksLabel: '', tracksHeading: '', tracksHeadingAccent: '',
  track1Title: '', track1Description: '', track1ImageUrl: '', track1Badge: '',
  track2Title: '', track2Description: '', track2ImageUrl: '', track2Badge: '',
  track3Title: '', track3Description: '', track3ImageUrl: '', track3Badge: '',
  impactLabel: '',
  stat1Value: '', stat1Label: '', stat1ImageUrl: '',
  stat2Value: '', stat2Label: '', stat2ImageUrl: '',
  stat3Value: '', stat3Label: '', stat3ImageUrl: '',
  stat4Value: '', stat4Label: '', stat4ImageUrl: '',
  statImgOverlay: '',
  partnersLabel: '',
  partner1Name: '', partner1LogoUrl: '',
  partner2Name: '', partner2LogoUrl: '',
  partner3Name: '', partner3LogoUrl: '',
  partner4Name: '', partner4LogoUrl: '',
  partner5Name: '', partner5LogoUrl: '',
  partner6Name: '', partner6LogoUrl: '',
  newsletterHeading: '', newsletterSubtext: '', newsletterButton: '',
  navBgColor: '', navTextColor: '',
  sectionDarkBg: '', sectionLightBg: '', sectionAltBg: '',
  textHeadingColor: '', textBodyColor: '', textMutedColor: '',
  textOnDarkColor: '', textOnAltColor: '',
  cardBadgeBg: '', cardBadgeText: '',
  cardOverlayColor: '', cardOverlayOpacity: '',
  hideOfferings: '', hideSteps: '', hideFeatures: '',
  hideTestimonials: '', hideCta: '', hidePartners: '', hideStats: '',
  ad1Label: '', ad1Title: '', ad1Description: '', ad1CtaText: '', ad1CtaUrl: '', ad1BgColor: '', ad1BgImage: '',
  ad2Label: '', ad2Title: '', ad2Description: '', ad2CtaText: '', ad2CtaUrl: '', ad2BgColor: '', ad2BgImage: '',
  ad3Label: '', ad3Title: '', ad3Description: '', ad3CtaText: '', ad3CtaUrl: '', ad3BgColor: '', ad3BgImage: '',
  hideAdBanner: '',
  midAd1Label: '', midAd1Title: '', midAd1Description: '', midAd1CtaText: '', midAd1CtaUrl: '', midAd1BgColor: '', midAd1BgImage: '',
  midAd2Label: '', midAd2Title: '', midAd2Description: '', midAd2CtaText: '', midAd2CtaUrl: '', midAd2BgColor: '', midAd2BgImage: '',
  hideMidAdBanner: '',
  ad1ImageLayout: '', ad2ImageLayout: '', ad3ImageLayout: '', midAd1ImageLayout: '', midAd2ImageLayout: '', adBannerFullWidth: '',
  siteDarkMode: '',
};

const MOMENTUM_EMPTY = {
  offeringsLabel: '', offeringsHeading: '', offeringsHeadingAccent: '', offeringsSubtext: '',
  offering1Title: '', offering1Description: '', offering1Badge: '',
  offering2Title: '', offering2Description: '', offering2Badge: '',
  offering3Title: '', offering3Description: '', offering3Badge: '',
  offering4Title: '', offering4Description: '', offering4Badge: '',
  stepsLabel: '', stepsHeading: '', stepsHeadingAccent: '',
  step1Title: '', step1Body: '', step2Title: '', step2Body: '', step3Title: '', step3Body: '',
  featuresLabel: '', featuresHeading: '', featuresHeadingAccent: '', featuresSubtext: '', featuresCta: '',
  highlight1: '', highlight2: '', highlight3: '', highlight4: '',
  highlight5: '', highlight6: '', highlight7: '', highlight8: '',
  hideOfferings: '', hideSteps: '', hideFeatures: '',
  hideTestimonials: '', hideCta: '', hidePartners: '', hideStats: '',
  ad1Label: '', ad1Title: '', ad1Description: '', ad1CtaText: '', ad1CtaUrl: '', ad1BgColor: '', ad1BgImage: '',
  ad2Label: '', ad2Title: '', ad2Description: '', ad2CtaText: '', ad2CtaUrl: '', ad2BgColor: '', ad2BgImage: '',
  ad3Label: '', ad3Title: '', ad3Description: '', ad3CtaText: '', ad3CtaUrl: '', ad3BgColor: '', ad3BgImage: '',
  hideAdBanner: '',
  midAd1Label: '', midAd1Title: '', midAd1Description: '', midAd1CtaText: '', midAd1CtaUrl: '', midAd1BgColor: '', midAd1BgImage: '',
  midAd2Label: '', midAd2Title: '', midAd2Description: '', midAd2CtaText: '', midAd2CtaUrl: '', midAd2BgColor: '', midAd2BgImage: '',
  hideMidAdBanner: '',
  ad1ImageLayout: '', ad2ImageLayout: '', ad3ImageLayout: '', midAd1ImageLayout: '', midAd2ImageLayout: '', adBannerFullWidth: '',
  siteDarkMode: '',
};

export const TEMPLATES: Template[] = [
  {
    id:    'elevate',
    label: 'Elevate',
    defaults: {
      primaryColor: '#1a1a2e',
      accentColor:  '#e94560',
      headingFont:  'Inter',
      bodyFont:     'Inter',
      heroTitle:       'Choose Your Path.',
      heroTitleAccent: 'Transform Your Future.',
      heroSubheadline: 'Join thousands of ambitious professionals building in-demand skills through world-class programmes, mentorship, and real-world projects.',
      heroPrimaryCta:  'Explore programmes',
      heroImageUrl:    '',
      heroFontSize:    '62',
      heroOverlayColor:   '#000000',
      heroOverlayOpacity: '58',
      statsEnrolled:   '50,000+',
      statsRating:     '4.8',
      tracksLabel:          'Our programmes',
      tracksHeading:        'Build skills that',
      tracksHeadingAccent:  'open doors.',
      track1Title: 'AI & Data',          track1Description: 'Master the technologies driving the next decade. Learn Python, machine learning, and data science through hands-on projects.',  track1ImageUrl: '', track1Badge: 'Most popular',
      track2Title: 'Creative & Design',  track2Description: 'Develop in-demand creative skills across UX/UI, graphic design, video production, and digital storytelling.',                   track2ImageUrl: '', track2Badge: 'Growing fast',
      track3Title: 'Entrepreneurship',   track3Description: 'Launch and grow a business with support from mentors, investors, and a global network of successful founders.',                 track3ImageUrl: '', track3Badge: 'High impact',
      impactLabel: 'Our impact',
      stat1Value: '50,000+', stat1Label: 'Graduates worldwide',      stat1ImageUrl: '',
      stat2Value: '12,000+', stat2Label: 'Entrepreneurs supported',  stat2ImageUrl: '',
      stat3Value: '80%',     stat3Label: 'Employment rate',          stat3ImageUrl: '',
      stat4Value: '150+',    stat4Label: 'Countries represented',    stat4ImageUrl: '',
      statImgOverlay: '60',
      partnersLabel: 'Trusted by leading organisations',
      partner1Name: 'Google',     partner1LogoUrl: '',
      partner2Name: 'Microsoft',  partner2LogoUrl: '',
      partner3Name: 'Meta',       partner3LogoUrl: '',
      partner4Name: 'IBM',        partner4LogoUrl: '',
      partner5Name: 'Mastercard', partner5LogoUrl: '',
      partner6Name: 'UNICEF',     partner6LogoUrl: '',
      testimonialsLabel:   'Success stories',
      testimonialsHeading: 'Real people, real impact.',
      testimonialVideoUrl: '',
      testimonial1Name: 'Sarah Kimani', testimonial1Role: 'Data Scientist, Nairobi', testimonial1Text: 'The programme completely changed my trajectory. Within 6 months of graduating I had a full-time data science role at a leading tech company. The mentorship and community were invaluable.',
      testimonial2Name: 'David Mensah', testimonial2Role: 'UX Designer, Accra',     testimonial2Text: 'I came in with zero design experience and left with a portfolio that landed me three job offers. The curriculum is world-class and the instructors genuinely care about your success.',
      testimonial3Name: 'Amara Diallo', testimonial3Role: 'Founder, Dakar',         testimonial3Text: 'The entrepreneurship track gave me the frameworks and network I needed to launch my startup. We raised our first funding round just 4 months after graduating.',
      newsletterHeading: 'Ready to transform',
      newsletterSubtext: 'Join thousands of professionals who chose to invest in themselves. Your next chapter starts here.',
      newsletterButton:  'Start your journey',
      ctaHeading:       'Ready to transform',
      ctaHeadingAccent: 'your career?',
      ctaSubtext:       'Join thousands of professionals who chose to invest in themselves. Your next chapter starts here.',
      ctaButton:        'Start your journey',
      footerTagline:    'Empowering the next generation of professionals through world-class education and mentorship.',
      stickyCtaText:   'Join 50,000+ ambitious professionals.',
      stickyCtaButton: 'Explore programmes',
      hideStickyBar:   '',
      footerLinksHeading: 'Programmes',
      footerLink1Label: 'AI & Data',       footerLink1Url: '/auth',
      footerLink2Label: 'Creative & Design', footerLink2Url: '/auth',
      footerLink3Label: 'Entrepreneurship', footerLink3Url: '/auth',
      footerLink4Label: 'Certificates',    footerLink4Url: '/auth',
      footerBgImageUrl: '', footerOverlayColor: '#0a0a1a', footerOverlayOpacity: '75',
      floatingCtaHeading:  'Subscribe to our updates.',
      floatingCtaSubtext:  'We bring together industry leaders to share insights, spark ideas, and help you level up.',
      floatingCtaButton:   'Subscribe Now',
      floatingCtaImageUrl: '',
      floatingCtaBgColor:  '',
      hideFloatingCta:     '',
      navBgColor:       '#ffffff',
      navTextColor:     '#111111',
      sectionDarkBg:    '#0d0d0d',
      sectionLightBg:   '#ffffff',
      sectionAltBg:     '#f8f9fa',
      textHeadingColor: '#111111',
      textBodyColor:    '#6b7280',
      textMutedColor:   '#9ca3af',
      textOnDarkColor:  '#ffffff',
      textOnAltColor:   '#111111',
      cardBadgeBg:      '#ffffff',
      cardBadgeText:    '#1a1a2e',
      cardOverlayColor:   '#0a0a1a',
      cardOverlayOpacity: '55',
      ...MOMENTUM_EMPTY,
    },
  },
  {
    id:    'modern',
    label: 'Modern',
    defaults: {
      primaryColor:   '#0056D2',
      accentColor:    '#FF9933',
      headingFont:    'Inter',
      bodyFont:       'Inter',
      heroTitle:          'Learn the skills',
      heroTitleAccent:    'Africa needs most.',
      heroSubheadline:    'Master AI, data, and digital skills through courses, guided learning paths, and virtual experiences built for African professionals.',
      heroPrimaryCta:     'Start learning free',
      heroImageUrl:       '',
      heroFontSize:       '56',
      heroOverlayColor:   '#000000',
      heroOverlayOpacity: '0',
      statsEnrolled:      '10,000+',
      statsRating:        '4.9',
      // Offerings (unused by this template)
      offeringsLabel: '', offeringsHeading: '', offeringsHeadingAccent: '', offeringsSubtext: '',
      offering1Title: '', offering1Description: '', offering1Badge: '',
      offering2Title: '', offering2Description: '', offering2Badge: '',
      offering3Title: '', offering3Description: '', offering3Badge: '',
      offering4Title: '', offering4Description: '', offering4Badge: '',
      // Steps (unused)
      stepsLabel: '', stepsHeading: '', stepsHeadingAccent: '',
      step1Title: '', step1Body: '', step2Title: '', step2Body: '', step3Title: '', step3Body: '',
      // Features (unused)
      featuresLabel: '', featuresHeading: '', featuresHeadingAccent: '', featuresSubtext: '', featuresCta: '',
      highlight1: '', highlight2: '', highlight3: '', highlight4: '',
      highlight5: '', highlight6: '', highlight7: '', highlight8: '',
      // Testimonials
      testimonialsLabel:   'Learner stories',
      testimonialsHeading: 'Real results from real people',
      testimonial1Name: 'Amina Osei',        testimonial1Role: 'Data Analyst, Accra',              testimonial1Text: 'This platform gave me the practical skills I needed to move from Excel to Python and SQL. Within three months I landed a data analyst role at a fintech company.',
      testimonial2Name: 'Chukwuemeka Nwosu', testimonial2Role: 'BI Lead, Lagos',                   testimonial2Text: 'The guided projects are exactly what I needed. Real business scenarios, not textbook exercises. My team now relies on dashboards I built from what I learned here.',
      testimonial3Name: 'Fatima Al-Hassan',  testimonial3Role: 'HR Analytics Specialist, Nairobi', testimonial3Text: 'The live workshops gave me direct access to industry experts. The certificate I earned opened doors that years of self-study could not. Highly recommended.',
      testimonialVideoUrl: '',
      // CTA
      // Modern is the only template that renders these, and until now nothing in the dashboard
      // could edit them -- so the default WAS the copy, on every tenant. It has to be neutral and
      // it must not assert a headcount or a free tier that a given tenant may not offer.
      ctaHeading:       'Start with one course.',
      ctaHeadingAccent: 'Build from there.',
      ctaSubtext:       'Create an account to save your progress, collect credentials and pick up where you left off.',
      ctaButton:        'Create free account',
      // Footer
      footerTagline:    'The AI and data skills platform built for African professionals. Learn, practise, and prove your skills.',
      // Sticky
      stickyCtaText:   "Join 10,000+ professionals building Africa's future.",
      stickyCtaButton: 'Start for free',
      hideStickyBar:   '',
      // Footer links
      footerLinksHeading: 'Learn',
      footerLink1Label: 'Courses',               footerLink1Url: '/auth',
      footerLink2Label: 'Learning Paths',        footerLink2Url: '/auth',
      footerLink3Label: 'Virtual Experiences',   footerLink3Url: '/auth',
      footerLink4Label: 'Certificates',          footerLink4Url: '/auth',
      footerBgImageUrl: '', footerOverlayColor: '#000000', footerOverlayOpacity: '70',
      floatingCtaHeading: '', floatingCtaSubtext: '', floatingCtaButton: '',
      floatingCtaImageUrl: '', floatingCtaBgColor: '', hideFloatingCta: '1',
      // Elevate fields (stats, partners, tracks re-used)
      tracksLabel: '', tracksHeading: '', tracksHeadingAccent: '',
      track1Title: '', track1Description: '', track1ImageUrl: '', track1Badge: '',
      track2Title: '', track2Description: '', track2ImageUrl: '', track2Badge: '',
      track3Title: '', track3Description: '', track3ImageUrl: '', track3Badge: '',
      impactLabel: '',
      stat1Value: '10,000+', stat1Label: 'Learners across Africa',
      stat2Value: '91%',     stat2Label: 'Report career advancement',
      stat3Value: '50+',     stat3Label: 'Courses and experiences',
      stat4Value: '4.9',     stat4Label: 'Average learner rating',
      stat1ImageUrl: '', stat2ImageUrl: '', stat3ImageUrl: '', stat4ImageUrl: '',
      statImgOverlay: '',
      partnersLabel: "Trusted by Africa's leading organisations",
      partner1Name: 'Google',     partner1LogoUrl: '',
      partner2Name: 'Microsoft',  partner2LogoUrl: '',
      partner3Name: 'MTN',        partner3LogoUrl: '',
      partner4Name: 'Ecobank',    partner4LogoUrl: '',
      partner5Name: 'Mastercard', partner5LogoUrl: '',
      partner6Name: 'UNICEF',     partner6LogoUrl: '',
      newsletterHeading: '', newsletterSubtext: '', newsletterButton: '',
      navBgColor: '#ffffff', navTextColor: '#111111',
      sectionDarkBg: '#003262', sectionLightBg: '#ffffff', sectionAltBg: '#F7F9FC',
      textHeadingColor: '#003262', textBodyColor: '#6E7383', textMutedColor: '#9ca3af',
      textOnDarkColor: '#ffffff', textOnAltColor: '#111111',
      cardBadgeBg: 'rgba(255,255,255,0.22)', cardBadgeText: '#ffffff',
      cardOverlayColor: '#0a0a1a', cardOverlayOpacity: '55',
      hideOfferings: '1', hideSteps: '1', hideFeatures: '1',
      hideTestimonials: '', hideCta: '', hidePartners: '', hideStats: '',
      ad1Label: 'New', ad1Title: 'Start your learning journey today', ad1Description: 'Access courses, learning paths and virtual experiences built for African professionals.', ad1CtaText: 'Get started free', ad1CtaUrl: '/auth?mode=signup', ad1BgColor: '#0056D2', ad1BgImage: '',
      ad2Label: 'Featured', ad2Title: 'Build job-ready skills with virtual internships', ad2Description: 'Gain real-world experience and add portfolio projects that employers recognise.', ad2CtaText: 'Explore experiences', ad2CtaUrl: '/auth', ad2BgColor: '#003262', ad2BgImage: '',
      ad3Label: 'Popular', ad3Title: 'Guided learning paths for your career goals', ad3Description: 'Curated courses and projects that take you from beginner to job-ready.', ad3CtaText: 'View learning paths', ad3CtaUrl: '/auth', ad3BgColor: '#064E3B', ad3BgImage: '',
      hideAdBanner: '',
      midAd1Label: 'Trending', midAd1Title: 'Enrol in a guided learning path', midAd1Description: 'Follow a curated sequence of courses and projects designed to take you from beginner to job-ready.', midAd1CtaText: 'Browse paths', midAd1CtaUrl: '/auth', midAd1BgColor: '#0056D2', midAd1BgImage: '',
      midAd2Label: 'Free', midAd2Title: 'Start your first course today', midAd2Description: 'No credit card required. Access your first course free and experience the platform before you commit.', midAd2CtaText: 'Get started free', midAd2CtaUrl: '/auth?mode=signup', midAd2BgColor: '#064E3B', midAd2BgImage: '',
      hideMidAdBanner: '',
      ad1ImageLayout: '', ad2ImageLayout: '', ad3ImageLayout: '', midAd1ImageLayout: '', midAd2ImageLayout: '', adBannerFullWidth: '',
      siteDarkMode: '',
    },
  },
  // Add new templates here -- the dashboard picks them up automatically.
];

const LEGACY_ID_MAP: Record<string, string> = { coursera: 'modern', momentum: 'modern' };

export function getTemplate(id: string): Template {
  const resolved = LEGACY_ID_MAP[id] ?? id;
  return TEMPLATES.find(t => t.id === resolved) ?? TEMPLATES[0];
}

/** Merge saved config over template defaults so missing keys always have a value. */
export function resolveConfig(template: string, saved: Partial<SiteConfig>): SiteConfig {
  return { ...getTemplate(template).defaults, ...saved };
}
