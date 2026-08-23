export const tenant = {
  appName:         process.env.NEXT_PUBLIC_APP_NAME          ?? '',
  appDescription:  process.env.NEXT_PUBLIC_APP_DESCRIPTION   ?? '',
  orgName:         process.env.NEXT_PUBLIC_ORG_NAME          ?? '',
  appUrl:          (process.env.NEXT_PUBLIC_APP_URL           ?? '').replace(/\/$/, ''),
  logoUrl:         process.env.NEXT_PUBLIC_LOGO_URL          ?? '',
  logoDarkUrl:     process.env.NEXT_PUBLIC_LOGO_DARK_URL     ?? '',
  teamName:        process.env.NEXT_PUBLIC_TEAM_NAME         ?? '',
  senderName:      process.env.NEXT_PUBLIC_SENDER_NAME       ?? '',
  supportEmail:    process.env.NEXT_PUBLIC_SUPPORT_EMAIL     ?? '',
  brandColor:      process.env.NEXT_PUBLIC_BRAND_COLOR       ?? '#2563eb',
  faviconUrl:      '/icon.png',
  emailBannerUrl:  process.env.NEXT_PUBLIC_EMAIL_BANNER_URL  ?? '',
  whatsappCommunityUrl: process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '',

  // Whether anyone may create their own account, as opposed to admissions being added by staff.
  // This is the ENV FALLBACK only, used when no platform_settings row exists; the real value lives
  // in the database so it can be switched without a deploy. Closed is the safe default, so an
  // unconfigured or brand-new tenant is invite-only rather than accidentally open to the internet.
  publicSignupEnabled: process.env.NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED === 'true',

  // Landing page branding
  primaryColor:    process.env.NEXT_PUBLIC_PRIMARY_COLOR     ?? '#2563eb',
  accentColor:     process.env.NEXT_PUBLIC_ACCENT_COLOR      ?? '#f59e0b',
  heroTitle:       process.env.NEXT_PUBLIC_HERO_TITLE        ?? '',
  heroTitleAccent: process.env.NEXT_PUBLIC_HERO_TITLE_ACCENT ?? '',
  heroSubheadline: process.env.NEXT_PUBLIC_HERO_SUBHEADLINE  ?? '',
  heroPrimaryCta:  process.env.NEXT_PUBLIC_HERO_PRIMARY_CTA  ?? 'Get started',
  footerTagline:   process.env.NEXT_PUBLIC_FOOTER_TAGLINE    ?? '',
  statsEnrolled:   process.env.NEXT_PUBLIC_STATS_ENROLLED    ?? '',
  statsRating:     process.env.NEXT_PUBLIC_STATS_RATING      ?? '',
};
