'use client';


import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useInView, AnimatePresence, useMotionValue, useSpring, useScroll, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { useTheme } from '@/components/ThemeProvider';
import { resolveConfig, type SiteConfig } from '@/lib/site-templates';
import { ArrowRight, Check, LayoutDashboard, ChevronDown, ChevronLeft, ChevronRight, User, Settings, LogOut, BookOpen, Calendar, Briefcase, Award, TrendingUp, Users, Zap, BarChart3, GraduationCap, Play, Brain, Megaphone, Banknote, Palette, Code2, Globe, HeartPulse } from 'lucide-react';
import { HoverPreviewCard } from '@/components/student/shared';
import { useToolIcons } from '@/lib/use-tool-icons';
import { getFontById, loadGoogleFont } from '@/lib/fonts';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';

// --- FadeIn on scroll ---
function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div ref={ref} initial={false}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.23, 1, 0.32, 1] }}
      className={className}>
      {children}
    </motion.div>
  );
}

// --- Floating orb ---
function Orb({ x, y, size, color, delay }: { x: string; y: string; size: number; color: string; delay: number }) {
  return (
    <motion.div className="absolute rounded-full pointer-events-none"
      style={{ left: x, top: y, width: size, height: size, background: color, filter: 'blur(130px)', opacity: 0.35 }}
      animate={{ scale: [1, 1.18, 1], opacity: [0.35, 0.5, 0.35] }}
      transition={{ duration: 8 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

// --- Nav profile menu ---
function NavProfileMenu({ user, profile, pageDark }: { user: any; profile: any; pageDark?: boolean }) {
  const { theme } = useTheme();
  const isDark = pageDark ?? (theme === 'dark');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const card    = isDark ? '#1E1F26' : 'white';
  const divider = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text    = isDark ? '#f0f0f0' : '#111';
  const faint   = isDark ? '#6b7a89' : '#888';
  const pill    = isDark ? '#2a2b34' : '#F4F4F4';
  const cta     = isDark ? '#3E93FF' : '#00bf63';
  const lime    = isDark ? 'rgba(62,147,255,0.15)' : '#dcfce7';
  const green   = isDark ? '#3E93FF' : '#00bf63';

  const signOutHover = isDark ? 'rgba(239,68,68,0.10)'   : 'rgba(239,68,68,0.08)';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const name     = profile?.name || profile?.full_name || user?.email?.split('@')[0] || 'User';
  const username = profile?.username;
  const initials = name.slice(0, 2).toUpperCase();
  const avatar   = profile?.avatar_url && /^https?:\/\//.test(profile.avatar_url) ? profile.avatar_url : null;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const menuItem = (href: string, Icon: React.ElementType, label: string, external?: boolean) => (
    <Link key={label} href={href} onClick={() => setOpen(false)}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all"
      style={{ color: text, textDecoration: 'none' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = pill; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
      <Icon className="w-[18px] h-[18px] flex-shrink-0" style={{ color: text }}/>
      {label}
    </Link>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all hover:shadow-sm"
        style={{
          background: isDark ? '#1E1F26' : 'white',
          borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)',
        }}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden flex-shrink-0"
          style={{ background: lime, color: green }}>
          {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover"/> : <span>{initials}</span>}
        </div>
        <span className="text-sm font-medium hidden sm:block pr-1" style={{ color: isDark ? 'white' : '#1C1D1F' }}>
          {name}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform mr-1 ${open ? 'rotate-180' : ''}`} style={{ color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-2 w-64 rounded-2xl overflow-hidden z-50"
            style={{
              background: card,
              fontFamily: "'Inter', sans-serif",
              boxShadow: isDark
                ? '0 20px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.07)'
                : '0 20px 60px rgba(0,0,0,0.13), 0 0 0 1px rgba(0,0,0,0.06)',
            }}
          >
            {/* Header */}
            <div className="px-4 py-4" style={{ borderBottom: `1px solid ${divider}` }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: lime, color: green }}>
                  {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover"/> : <span>{initials}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate" style={{ color: text }}>{name}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: faint }}>
                    {username ? `@${username}` : user?.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation items */}
            <div className="p-2">
              {menuItem('/dashboard', LayoutDashboard, 'Dashboard')}
              {menuItem('/student#courses', GraduationCap, 'My Learning')}
              {menuItem('/student#certificates', Award, 'My Certificates')}
              {username && menuItem(`/s/${username}`, User, 'View Profile', true)}
              {menuItem('/settings', Settings, 'Settings')}
            </div>

            {/* Sign out */}
            <div className="p-2" style={{ borderTop: `1px solid ${divider}` }}>
              <button onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                style={{ color: '#ef4444' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = signOutHover; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <LogOut className="w-[18px] h-[18px] flex-shrink-0"/>
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Icon map for offerings (fixed set, titles/descriptions come from config)
const OFFERING_ICONS = [BookOpen, Calendar, Briefcase, Award];
// Icon map for highlights (fixed set, text comes from config)
const HIGHLIGHT_ICONS = [BookOpen, Award, Calendar, Briefcase, TrendingUp, User, Check, Zap];

function ProgrammeLoadError({ dark = false }: { dark?: boolean }) {
  return (
    <div
      role="alert"
      className="mx-auto my-8 max-w-xl px-5 py-4 text-center rounded-lg border"
      style={{
        color: dark ? 'rgba(255,255,255,0.82)' : '#344054',
        borderColor: dark ? 'rgba(255,255,255,0.18)' : '#d0d5dd',
        background: dark ? 'rgba(255,255,255,0.06)' : '#ffffff',
      }}
    >
      <p className="text-sm">Some programmes could not be loaded.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-2 text-sm font-bold underline">
        Try again
      </button>
    </div>
  );
}

// --- Elevate Template ---
function ElevateTemplate({ user, profile, scrolled, pastHero, siteConfig, logoUrl, logoDarkUrl, appName, publicSignupEnabled, programmes, programmesError }: {
  user: any; profile: any; scrolled: boolean; pastHero: boolean; siteConfig: SiteConfig; logoUrl: string; logoDarkUrl: string; appName: string;
  publicSignupEnabled: boolean;
  programmes: ProgrammeItem[]; programmesError: boolean;
}) {
  const [hoveredTrack, setHoveredTrack] = useState<number | null>(null);
  const [hoveredSlide, setHoveredSlide] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'course' | 've' | 'path'>('all');
  const [sliderIdx, setSliderIdx] = useState(0);
  const PAGE = 3;

  // Load the landing-page fonts: Google Sans (Text) as primary, Inter as the backup.
  useEffect(() => {
    loadGoogleFont(getFontById('google-sans-text'));
    loadGoogleFont(getFontById('inter'));
  }, []);

  const filteredProgrammes = activeFilter === 'all' ? programmes : programmes.filter(p => p.type === activeFilter);

  const countByType = {
    course: programmes.filter(p => p.type === 'course').length,
    ve:     programmes.filter(p => p.type === 've').length,
    path:   programmes.filter(p => p.type === 'path').length,
  };

  const {
    primaryColor, accentColor, headingFont, bodyFont,
    heroTitle, heroTitleAccent, heroSubheadline, heroPrimaryCta, heroImageUrl, heroFontSize, heroOverlayColor, heroOverlayOpacity,
    tracksLabel, tracksHeading, tracksHeadingAccent,
    track1Title, track1Description, track1ImageUrl, track1Badge,
    track2Title, track2Description, track2ImageUrl, track2Badge,
    track3Title, track3Description, track3ImageUrl, track3Badge,
    impactLabel,
    stat1Value, stat1Label, stat1ImageUrl,
    stat2Value, stat2Label, stat2ImageUrl,
    stat3Value, stat3Label, stat3ImageUrl,
    stat4Value, stat4Label, stat4ImageUrl,
    statImgOverlay,
    partnersLabel,
    partner1Name, partner1LogoUrl, partner2Name, partner2LogoUrl,
    partner3Name, partner3LogoUrl, partner4Name, partner4LogoUrl,
    partner5Name, partner5LogoUrl, partner6Name, partner6LogoUrl,
    testimonialsLabel, testimonialsHeading, testimonialVideoUrl,
    testimonial1Name, testimonial1Role, testimonial1Text,
    newsletterHeading, newsletterSubtext, newsletterButton,
    ctaHeadingAccent, footerTagline,
    hidePartners, hideStats, hideTestimonials, hideCta,
    floatingCtaHeading, floatingCtaSubtext, floatingCtaButton, floatingCtaImageUrl, floatingCtaBgColor, hideFloatingCta,
    stickyCtaText, stickyCtaButton, hideStickyBar,
    footerLinksHeading, footerLink1Label, footerLink1Url,
    footerLink2Label, footerLink2Url, footerLink3Label, footerLink3Url,
    footerLink4Label, footerLink4Url,
    footerBgImageUrl, footerOverlayColor, footerOverlayOpacity,
    navBgColor, navTextColor,
    sectionDarkBg, sectionLightBg, sectionAltBg,
    textHeadingColor, textBodyColor, textMutedColor,
    textOnDarkColor, textOnAltColor,
    cardBadgeBg, cardBadgeText,
    cardOverlayColor, cardOverlayOpacity,
  } = siteConfig;

  const overlayRgb = (() => {
    const c = cardOverlayColor || '#0a0a1a';
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return `${r},${g},${b}`;
  })();
  const overlayAlpha = parseFloat(cardOverlayOpacity || '55') / 100;

  const footerOvRgb = (() => {
    const c = footerOverlayColor || '#0a0a1a';
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return `${r},${g},${b}`;
  })();
  const footerOvAlpha = parseFloat(footerOverlayOpacity || '75') / 100;

  const nav_bg   = navBgColor       || '#ffffff';
  const nav_text = navTextColor      || '#111111';
  const dark_bg  = sectionDarkBg    || '#0d0d0d';
  const light_bg = sectionLightBg   || '#ffffff';
  const alt_bg   = sectionAltBg     || '#f8f9fa';
  const h_color  = textHeadingColor || '#111111';
  const b_color  = textBodyColor    || '#6b7280';
  const m_color  = textMutedColor   || '#9ca3af';
  const on_dark  = textOnDarkColor  || '#ffffff';
  const on_alt   = textOnAltColor   || '#111111';

  // Landing page font: Google Sans (Text) with Inter as the backup. A site-configured font, if set,
  // still takes precedence as the first choice; Inter then sans-serif are the fallbacks.
  const hFont = `'${headingFont || 'Google Sans Text'}', 'Inter', sans-serif`;
  const bFont = `'${bodyFont    || 'Google Sans Text'}', 'Inter', sans-serif`;

  const tracks = [
    { title: track1Title, desc: track1Description, img: track1ImageUrl, badge: track1Badge },
    { title: track2Title, desc: track2Description, img: track2ImageUrl, badge: track2Badge },
    { title: track3Title, desc: track3Description, img: track3ImageUrl, badge: track3Badge },
  ];
  const stats = [
    { value: stat1Value, label: stat1Label, img: stat1ImageUrl },
    { value: stat2Value, label: stat2Label, img: stat2ImageUrl },
    { value: stat3Value, label: stat3Label, img: stat3ImageUrl },
    { value: stat4Value, label: stat4Label, img: stat4ImageUrl },
  ];
  const partners = [
    { name: partner1Name, logo: partner1LogoUrl },
    { name: partner2Name, logo: partner2LogoUrl },
    { name: partner3Name, logo: partner3LogoUrl },
    { name: partner4Name, logo: partner4LogoUrl },
    { name: partner5Name, logo: partner5LogoUrl },
    { name: partner6Name, logo: partner6LogoUrl },
  ].filter(p => p.name);

  return (
    <main className="landing-scope min-h-screen overflow-x-hidden font-sans antialiased" style={{ background: light_bg, fontFamily: bFont }}>

      {/* NAV */}
      <motion.nav
        initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-4 transition-all duration-300"
        style={{ background: nav_bg, boxShadow: scrolled ? '0 1px 24px rgba(0,0,0,0.10)' : `0 1px 0 rgba(0,0,0,0.06)` }}
      >
        <img src={logoDarkUrl || logoUrl || undefined} alt="" className="h-9 w-auto" />
        <div className="flex items-center gap-3">
          {user ? <NavProfileMenu user={user} profile={profile} /> : (
            <>
              {/* Signups open: the pill becomes Sign up at every width, and Log in stops being
                  desktop-only -- on a phone the pill was the ONLY control, so there was no way to
                  reach the signup form at all. Signups closed: this is exactly the old markup,
                  where "Get started" leads to the invite-only explanation. */}
              <Link
                href="/auth"
                className={`text-sm font-medium transition-opacity hover:opacity-60 ${publicSignupEnabled ? 'block' : 'hidden sm:block'}`}
                style={{ color: nav_text }}
              >
                Log in
              </Link>
              {publicSignupEnabled ? (
                <Link href="/auth?mode=signup" className="px-5 py-2.5 rounded-full text-sm font-bold transition-all hover:opacity-90" style={{ background: nav_text, color: nav_bg }}>
                  Sign up
                </Link>
              ) : (
                <>
                  <Link href="/auth" className="px-5 py-2.5 rounded-full text-sm font-bold transition-all hover:opacity-90 sm:hidden" style={{ background: nav_text, color: nav_bg }}>
                    Sign In
                  </Link>
                  <Link href="/auth?mode=signup" className="px-5 py-2.5 rounded-full text-sm font-bold transition-all hover:opacity-90 hidden sm:block" style={{ background: nav_text, color: nav_bg }}>
                    Get started
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      </motion.nav>

      {/* HERO */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 md:pt-28 pb-14 md:pb-20 overflow-hidden text-white"
        style={{
          background: `linear-gradient(145deg, #0f0c29 0%, ${primaryColor} 50%, #302b63 100%)`,
        }}>
        {heroImageUrl && (
          <img
            src={heroImageUrl}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0" style={{ background: (() => { const c = heroOverlayColor || '#000000'; const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16); return `rgba(${r},${g},${b},${parseFloat(heroOverlayOpacity||'58')/100})`; })() }} />
        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6 md:space-y-8">
          <motion.h1 initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.15 }}
            className="leading-[1.2] md:leading-[1.05]"
            style={{ fontFamily: hFont, fontWeight: 900, letterSpacing: '-0.02em', fontSize: `clamp(${Math.round(parseInt(heroFontSize||'62')*0.39)}px, ${(parseInt(heroFontSize||'62')/1200*100).toFixed(2)}vw, ${heroFontSize||'62'}px)` }}>
            <span style={{ color: 'white' }}>{heroTitle}</span><br />
            <span style={{ color: accentColor }}>{heroTitleAccent}</span>
          </motion.h1>
          <motion.p initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
            className="text-base md:text-[18px] max-w-xl mx-auto" style={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.75, fontFamily: bFont }}>
            {heroSubheadline}
          </motion.p>
        </div>
        <motion.div className="absolute bottom-10 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 8, 0] }} transition={{ duration: 2, repeat: Infinity }}>
          <ChevronDown className="w-5 h-5 text-white/30" />
        </motion.div>
      </section>

      {/* PARTNERS STRIP */}
      {hidePartners !== '1' && partners.length > 0 && (
        <section className="py-12 px-6 border-b" style={{ background: alt_bg, borderColor: 'rgba(0,0,0,0.06)' }}>
          <div className="max-w-5xl mx-auto">
            <p className="text-center text-[11px] font-bold uppercase tracking-widest mb-8" style={{ color: on_alt, opacity: 0.5 }}>
              {partnersLabel || 'Trusted by leading organisations'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
              {partners.map((p, i) => (
                <div key={i} className="h-10 flex items-center justify-center">
                  {p.logo
                    ? <img src={p.logo} alt={p.name} className="h-8 w-auto object-contain grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all" />
                    : <span className="text-[15px] font-bold tracking-tight" style={{ color: '#bbb' }}>{p.name}</span>
                  }
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* PROGRAMMES / TRACKS */}
      <section className="py-14 md:py-24 overflow-hidden" style={{ background: light_bg }}>
        <div className="max-w-6xl mx-auto px-6">
          <FadeIn className="flex flex-col md:flex-row md:items-end md:justify-between mb-8 md:mb-12 gap-6">
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>{tracksLabel || 'Our programmes'}</p>
              <h2 className="text-[30px] md:text-[50px] font-black leading-[1.05]"
                style={{ color: h_color, letterSpacing: '-0.025em', fontFamily: hFont }}>
                {tracksHeading}<br /><span style={{ color: accentColor }}>{tracksHeadingAccent}</span>
              </h2>
            </div>
            {filteredProgrammes.length > PAGE && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setSliderIdx(Math.max(0, sliderIdx - PAGE))}
                  disabled={sliderIdx === 0}
                  className="w-10 h-10 rounded-full border flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30"
                  style={{ borderColor: h_color + '33', color: h_color }}>
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                <button onClick={() => setSliderIdx(Math.min(filteredProgrammes.length - PAGE, sliderIdx + PAGE))}
                  disabled={sliderIdx + PAGE >= filteredProgrammes.length}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30"
                  style={{ background: primaryColor, color: '#fff' }}>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </FadeIn>
        </div>

        {programmesError && <ProgrammeLoadError />}

        {filteredProgrammes.length > 0 ? (<>
          {/* -- Mobile: horizontal snap scroll -- */}
          <div className="md:hidden overflow-x-auto pb-4 -mx-6" style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}>
            <div className="flex gap-3 px-6">
              {filteredProgrammes.map((p, i) => {
                const typeLabel = p.type === 've' ? 'Guided Project' : p.type === 'path' ? 'Learning Path' : 'Course';
                return (
                  <Link key={p.id} href={user ? '/student' : '/auth'}
                    className="relative flex-shrink-0 rounded-2xl overflow-hidden"
                    style={{ width: '80vw', maxWidth: 320, height: 380, scrollSnapAlign: 'start' }}>
                    <div className="absolute inset-0" style={{
                      background: p.imageUrl ? `url(${p.imageUrl}) center/cover` : `linear-gradient(160deg, ${primaryColor}, #000)`,
                    }} />
                    <div className="absolute inset-0" style={{ background: `rgba(${overlayRgb},${overlayAlpha})` }} />
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 55%, rgba(0,0,0,0) 100%)' }} />
                    <div className="absolute inset-0 p-5 flex flex-col justify-between">
                      <span className="inline-block self-start text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md"
                        style={{ background: cardBadgeBg || 'rgba(255,255,255,0.15)', color: cardBadgeText || 'rgba(255,255,255,0.85)', backdropFilter: 'blur(6px)' }}>
                        {typeLabel}
                      </span>
                      <div className="space-y-2">
                        {p.description && <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.72)' }}>{p.description}</p>}
                        <div className="flex items-end justify-between gap-3">
                          <h3 className="text-lg font-black leading-tight" style={{ color: '#ffffff', fontFamily: hFont }}>{p.title}</h3>
                          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: accentColor }}>
                            <ArrowRight className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
              <div className="flex-shrink-0 w-2" /> {/* trailing space */}
            </div>
          </div>

          {/* -- Desktop: 3-card flex expand -- */}
          <div className="hidden md:block max-w-6xl mx-auto px-6">
            <div className="flex gap-4 items-stretch" onMouseLeave={() => setHoveredSlide(null)}>
            {filteredProgrammes.slice(sliderIdx, sliderIdx + PAGE).map((p, i) => {
              const expanded = hoveredSlide === i || (hoveredSlide === null && i === 0);
              const typeLabel = p.type === 've' ? 'Guided Project' : p.type === 'path' ? 'Learning Path' : 'Course';
              return (
                <motion.div
                  key={p.id}
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1, ease: [0.23, 1, 0.32, 1] }}
                  className="relative rounded-2xl overflow-hidden"
                  style={{
                    flex: expanded ? '2.2 0 0' : '1 0 0',
                    minWidth: 0,
                    height: 480,
                    transition: 'flex 0.45s cubic-bezier(0.4,0,0.2,1)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={() => setHoveredSlide(i)}
                  onMouseLeave={() => setHoveredSlide(null)}
                >
                  {/* Background image */}
                  <div className="absolute inset-0" style={{
                    background: p.imageUrl
                      ? `url(${p.imageUrl}) center/cover`
                      : `linear-gradient(160deg, ${primaryColor}, #000)`,
                    transform: expanded ? 'scale(1.04)' : 'scale(1)',
                    transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
                  }} />

                  {/* Configurable colour overlay */}
                  <div className="absolute inset-0" style={{
                    background: `rgba(${overlayRgb},${overlayAlpha})`,
                  }} />

                  {/* Readability gradient -- always-on bottom fade */}
                  <div className="absolute inset-0" style={{
                    background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0) 100%)',
                  }} />

                  {/* Content */}
                  <div className="absolute inset-0 p-6 flex flex-col justify-between">
                    {/* Top -- type tag */}
                    <div>
                      <span className="inline-block text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md"
                        style={{ background: cardBadgeBg || 'rgba(255,255,255,0.15)', color: cardBadgeText || 'rgba(255,255,255,0.85)', backdropFilter: 'blur(6px)' }}>
                        {typeLabel}
                      </span>
                    </div>

                    {/* Bottom -- title + description + cta */}
                    <div className="space-y-3">
                      {/* Description -- fades in when expanded */}
                      <div style={{
                        maxHeight: expanded ? 120 : 0,
                        opacity: expanded ? 1 : 0,
                        overflow: 'hidden',
                        transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease',
                        transitionDelay: expanded ? '0.1s' : '0s',
                      }}>
                        {p.description && (
                          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.78)', fontFamily: bFont }}>
                            {p.description}
                          </p>
                        )}
                      </div>

                      {/* Title + arrow row */}
                      <div className="flex items-end justify-between gap-4">
                        <h3 className="font-black leading-tight" style={{
                          color: '#ffffff',
                          fontFamily: hFont,
                          fontSize: expanded ? 24 : 18,
                          transition: 'font-size 0.3s ease',
                          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {p.title}
                        </h3>

                        {/* CTA button */}
                        <div style={{
                          opacity: expanded ? 1 : 0,
                          transform: expanded ? 'scale(1)' : 'scale(0.6)',
                          transition: 'opacity 0.3s ease, transform 0.3s ease',
                          transitionDelay: expanded ? '0.15s' : '0s',
                          flexShrink: 0,
                        }}>
                          <Link
                            href={user ? '/student' : '/auth'}
                            className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
                            style={{ background: accentColor }}
                          >
                            <ArrowRight className="w-5 h-5 text-white" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            </div>
            {/* Prev / Next */}
            {filteredProgrammes.length > PAGE && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <button
                  onClick={() => setSliderIdx(Math.max(0, sliderIdx - PAGE))}
                  disabled={sliderIdx === 0}
                  className="w-11 h-11 rounded-full flex items-center justify-center border-2 transition-all disabled:opacity-30"
                  style={{ borderColor: accentColor, color: accentColor, background: 'transparent' }}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm font-mono" style={{ color: on_alt }}>
                  {Math.floor(sliderIdx / PAGE) + 1} / {Math.ceil(filteredProgrammes.length / PAGE)}
                </span>
                <button
                  onClick={() => setSliderIdx(Math.min(filteredProgrammes.length - PAGE, sliderIdx + PAGE))}
                  disabled={sliderIdx + PAGE >= filteredProgrammes.length}
                  className="w-11 h-11 rounded-full flex items-center justify-center border-2 transition-all disabled:opacity-30"
                  style={{ borderColor: accentColor, color: accentColor, background: 'transparent' }}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </>) : (<>
          {/* Static fallback -- mobile snap scroll */}
          <div className="md:hidden overflow-x-auto pb-4 -mx-6" style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}>
            <div className="flex gap-3 px-6">
              {tracks.filter(t => t.title).map((t, i) => (
                <Link key={i} href={user ? '/student' : '/auth'}
                  className="relative flex-shrink-0 rounded-2xl overflow-hidden"
                  style={{ width: '80vw', maxWidth: 320, height: 380, scrollSnapAlign: 'start' }}>
                  <div className="absolute inset-0" style={{ background: t.img ? `url(${t.img}) center/cover` : `linear-gradient(160deg, ${primaryColor}, #000)` }} />
                  <div className="absolute inset-0" style={{ background: `rgba(${overlayRgb},${overlayAlpha})` }} />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 55%, rgba(0,0,0,0) 100%)' }} />
                  <div className="absolute inset-0 p-5 flex flex-col justify-between">
                    {t.badge && <span className="inline-block self-start text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md"
                      style={{ background: cardBadgeBg || 'rgba(255,255,255,0.15)', color: cardBadgeText || 'rgba(255,255,255,0.85)', backdropFilter: 'blur(6px)' }}>{t.badge}</span>}
                    <div className="space-y-2">
                      {t.desc && <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.72)' }}>{t.desc}</p>}
                      <div className="flex items-end justify-between gap-3">
                        <h3 className="text-lg font-black leading-tight text-white" style={{ fontFamily: hFont }}>{t.title}</h3>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: accentColor }}>
                          <ArrowRight className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
              <div className="flex-shrink-0 w-2" />
            </div>
          </div>

          {/* Static fallback -- desktop flex expand */}
          <div className="hidden md:block max-w-6xl mx-auto px-6">
            <div className="flex gap-4 items-stretch" onMouseLeave={() => setHoveredTrack(null)}>
              {tracks.filter(t => t.title).map((t, i) => {
                const expanded = hoveredTrack === i || (hoveredTrack === null && i === 0);
                return (
                  <motion.div
                    key={i}
                    initial={false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: i * 0.1, ease: [0.23, 1, 0.32, 1] }}
                    className="relative rounded-2xl overflow-hidden"
                    style={{
                      flex: expanded ? '2.2 0 0' : '1 0 0',
                      minWidth: 0,
                      height: 480,
                      transition: 'flex 0.45s cubic-bezier(0.4,0,0.2,1)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={() => setHoveredTrack(i)}
                    onMouseLeave={() => setHoveredTrack(null)}
                  >
                    {/* Background image */}
                    <div className="absolute inset-0" style={{
                      background: t.img
                        ? `url(${t.img}) center/cover`
                        : `linear-gradient(160deg, ${primaryColor}, #000)`,
                      transform: expanded ? 'scale(1.04)' : 'scale(1)',
                      transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
                    }} />
                    {/* Configurable overlay */}
                    <div className="absolute inset-0" style={{ background: `rgba(${overlayRgb},${overlayAlpha})` }} />
                    {/* Bottom fade */}
                    <div className="absolute inset-0" style={{
                      background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.3) 45%, rgba(0,0,0,0) 100%)',
                    }} />
                    {/* Content */}
                    <div className="absolute inset-0 p-6 flex flex-col justify-between">
                      <div>
                        {t.badge && (
                          <span className="inline-block text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md"
                            style={{ background: cardBadgeBg || 'rgba(255,255,255,0.15)', color: cardBadgeText || 'rgba(255,255,255,0.85)', backdropFilter: 'blur(6px)' }}>
                            {t.badge}
                          </span>
                        )}
                      </div>
                      <div className="space-y-3">
                        {/* Description fades in on expand */}
                        <div style={{
                          maxHeight: expanded ? 120 : 0,
                          opacity: expanded ? 1 : 0,
                          overflow: 'hidden',
                          transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease',
                          transitionDelay: expanded ? '0.1s' : '0s',
                        }}>
                          {t.desc && (
                            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.78)', fontFamily: bFont }}>
                              {t.desc}
                            </p>
                          )}
                        </div>
                        <div className="flex items-end justify-between gap-4">
                          <h3 className="font-black leading-tight" style={{
                            color: '#ffffff',
                            fontFamily: hFont,
                            fontSize: expanded ? 24 : 18,
                            transition: 'font-size 0.3s ease',
                            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {t.title}
                          </h3>
                          <div style={{
                            opacity: expanded ? 1 : 0,
                            transform: expanded ? 'scale(1)' : 'scale(0.6)',
                            transition: 'opacity 0.3s ease, transform 0.3s ease',
                            transitionDelay: expanded ? '0.15s' : '0s',
                            flexShrink: 0,
                          }}>
                            <Link href={user ? '/student' : '/auth'}
                              className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
                              style={{ background: accentColor }}>
                              <ArrowRight className="w-5 h-5 text-white" />
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </>)}
      </section>

      {/* IMPACT STATS */}
      {hideStats !== '1' && <section className="py-14 md:py-24 px-6" style={{ background: dark_bg }}>
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-14 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>{impactLabel || 'Our impact'}</p>
            <h2 className="text-[30px] md:text-[46px] font-black leading-[1.1]"
              style={{ color: on_dark, fontFamily: hFont, letterSpacing: '-0.025em' }}>
              Numbers that speak<br />
              <span style={{ color: accentColor }}>for themselves.</span>
            </h2>
          </FadeIn>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((s, i) => (
              <FadeIn key={i} delay={i * 0.1}>
                <div className="rounded-2xl overflow-hidden relative" style={{ minHeight: 200 }}>
                  <div className="absolute inset-0"
                    style={{
                      background: s.img
                        ? `url(${s.img}) center/cover`
                        : `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08))`,
                      border: s.img ? 'none' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 16,
                    }} />
                  {s.img && <div className="absolute inset-0 rounded-2xl" style={{ background: `rgba(0,0,0,${(parseFloat(statImgOverlay || '60') / 100).toFixed(2)})` }} />}
                  <div className="relative z-10 p-6 flex flex-col justify-end" style={{ minHeight: 200 }}>
                    <p className="text-[38px] md:text-[48px] font-black leading-none" style={{ color: on_dark, fontFamily: hFont }}>{s.value}</p>
                    <p className="text-sm mt-2" style={{ color: on_dark, opacity: 0.6 }}>{s.label}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>}

      {/* TESTIMONIAL + VIDEO */}
      {hideTestimonials !== '1' && <section className="py-14 md:py-24 px-6" style={{ background: alt_bg }}>
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-10 md:mb-14 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>{testimonialsLabel}</p>
            <h2 className="text-[28px] md:text-[42px] font-black" style={{ color: on_alt, fontFamily: hFont, letterSpacing: '-0.02em' }}>
              {testimonialsHeading}
            </h2>
          </FadeIn>
          <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
            <FadeIn>
              <div className="relative rounded-3xl overflow-hidden group cursor-pointer"
                style={{
                  aspectRatio: '16/9',
                  background: testimonialVideoUrl
                    ? `url(${testimonialVideoUrl}) center/cover`
                    : `linear-gradient(135deg, #1a1a2e, ${primaryColor})`,
                }}>
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-white shadow-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <div style={{ width: 0, height: 0, marginLeft: 4, borderTop: '11px solid transparent', borderBottom: '11px solid transparent', borderLeft: `18px solid ${accentColor}` }} />
                  </div>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.15} className="space-y-6">
              <div className="text-4xl leading-none" style={{ color: accentColor, fontFamily: 'Georgia, serif' }}>&ldquo;</div>
              <p className="text-[20px] leading-relaxed font-medium" style={{ color: on_alt, fontFamily: hFont }}>
                {testimonial1Text}
              </p>
              <div className="flex items-center gap-3 pt-2">
                <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
                  style={{ background: primaryColor }}>
                  {(testimonial1Name || '').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-sm" style={{ color: on_alt }}>{testimonial1Name}</p>
                  <p className="text-xs" style={{ color: on_alt, opacity: 0.6 }}>{testimonial1Role}</p>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>}

      {/* CTA / NEWSLETTER */}
      {hideCta !== '1' && <section className="py-14 md:py-24 px-6" style={{ background: primaryColor }}>
        <FadeIn>
          <div className="max-w-2xl mx-auto text-center space-y-7">
            <h2 className="text-[32px] md:text-[52px] font-black leading-[1.05]"
              style={{ color: on_dark, fontFamily: hFont, letterSpacing: '-0.025em' }}>
              {newsletterHeading}<br />
              <span style={{ color: accentColor }}>{ctaHeadingAccent}</span>
            </h2>
            <p className="text-[17px]" style={{ color: on_dark, opacity: 0.68, lineHeight: 1.75, fontFamily: bFont }}>
              {newsletterSubtext}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href={user ? '/student' : '/auth'}
                className="group flex items-center gap-2 px-8 py-4 rounded-full text-base font-bold bg-white transition-all hover:scale-105 shadow-2xl"
                style={{ color: primaryColor }}>
                {user ? 'Go to dashboard' : newsletterButton}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <span className="text-sm" style={{ color: on_dark, opacity: 0.45 }}>No credit card required</span>
            </div>
          </div>
        </FadeIn>
      </section>}

      {/* STICKY CTA BAR */}
      {hideStickyBar !== '1' && (
        <AnimatePresence>
          {pastHero && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between gap-4 px-6 py-4"
              style={{ background: dark_bg, borderTop: `1px solid ${on_dark}1a`, backdropFilter: 'blur(12px)' }}
            >
              <p className="text-sm font-medium hidden sm:block" style={{ color: on_dark, opacity: 0.75 }}>
                {stickyCtaText}
              </p>
              <Link href={user ? '/student' : '/auth'}
                className="group flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold transition-all hover:scale-105 flex-shrink-0 ml-auto"
                style={{ background: accentColor, color: '#fff' }}>
                {user ? 'Go to dashboard' : stickyCtaButton}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* FOOTER */}
      <footer className="relative px-6"
        style={{ paddingTop: '80px', paddingBottom: '56px', background: footerBgImageUrl ? 'transparent' : dark_bg }}>
        {/* Optional background image + overlay */}
        {footerBgImageUrl && <>
          <div className="absolute inset-0 z-0" style={{ background: `url(${footerBgImageUrl}) center/cover no-repeat` }} />
          <div className="absolute inset-0 z-0" style={{ background: `rgba(${footerOvRgb},${footerOvAlpha})` }} />
        </>}
        {!footerBgImageUrl && <div className="absolute inset-0 z-0" style={{ background: dark_bg }} />}
        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
            <div className="md:col-span-2 space-y-4">
              <img src={logoDarkUrl || logoUrl || undefined} alt="" className="h-9 w-auto" />
              <p className="text-sm leading-relaxed max-w-xs" style={{ color: on_dark, opacity: 0.45 }}>{footerTagline}</p>
            </div>
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: on_dark, opacity: 0.3 }}>Account</p>
              {[{ label: 'Log in', href: '/auth' }, { label: 'Sign up', href: '/auth?mode=signup' }, { label: 'Dashboard', href: user ? '/student' : '/auth' }].map(l => (
                <Link key={l.label} href={l.href} className="block text-sm transition-colors" style={{ color: on_dark, opacity: 0.5 }}>{l.label}</Link>
              ))}
            </div>
          </div>
          <div className="pt-6 flex flex-col md:flex-row items-center justify-between gap-3" style={{ borderTop: `1px solid ${on_dark}1a` }}>
            <p className="text-xs" style={{ color: on_dark, opacity: 0.28 }}>&copy; {new Date().getFullYear()} {appName}. All rights reserved.</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs" style={{ color: on_dark, opacity: 0.28 }}>Platform operational</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

// --- Modern template helpers ---
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour
function shade(hex: string, amt: number): string {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const ch = (o: number) => {
    const v = parseInt(h.slice(o, o + 2), 16);
    const t = amt < 0 ? 0 : 255;
    return Math.round(v + (t - v) * Math.abs(amt)).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

// #rrggbb -> rgba() string with the given alpha
function hexRgba(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
}

// Scroll-linked rise/blur reveal used across the Modern template
function MReveal({ children, delay = 0, y = 26, blur = false, className = '' }: {
  children: React.ReactNode; delay?: number; y?: number; blur?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduced = useReducedMotion();
  return (
    <motion.div ref={ref}
      initial={false}
      animate={inView ? { opacity: 1, y: 0, ...(blur ? { filter: 'blur(0px)' } : {}) } : undefined}
      transition={{ duration: 0.7, delay, ease: EASE_OUT }}
      className={className}>
      {children}
    </motion.div>
  );
}

// Per-word masked rise for display headings
function WordReveal({ text, delay = 0, className = '', style }: {
  text: string; delay?: number; className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });
  const reduced = useReducedMotion();
  const words = (text || '').split(' ').filter(Boolean);
  if (reduced) return <span className={className} style={style}>{text}</span>;
  return (
    <span ref={ref} className={className} style={style}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span className="inline-block"
            initial={false}
            animate={inView ? { y: '0%' } : undefined}
            transition={{ duration: 0.65, delay: delay + i * 0.055, ease: EASE_OUT }}>
            {w + (i < words.length - 1 ? '\u00a0' : '')}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

// Magnetic hover wrapper for primary CTAs
function Magnetic({ children, strength = 0.16 }: { children: React.ReactNode; strength?: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.3 });
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.3 });
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div className="inline-block" style={{ x: sx, y: sy }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength * 1.6);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.div>
  );
}

// Thin scroll progress hairline above the nav
function LandingScrollProgress({ from, to }: { from: string; to: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 160, damping: 28, mass: 0.35 });
  return (
    <motion.div aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[3px] origin-left pointer-events-none"
      style={{ scaleX, zIndex: 60, background: `linear-gradient(90deg, ${from}, ${to})` }} />
  );
}

// Animated section heading: title, growing accent underline, subtext
function MSectionHeading({ title, sub, color, subColor, accent, hFont, bFont }: {
  title: string; sub: string; color: string; subColor: string; accent: string; hFont?: string; bFont?: string;
}) {
  return (
    <MReveal blur className="mb-7">
      <h2 style={{ fontFamily: hFont, fontWeight: 900, fontSize: 'clamp(23px,2.6vw,36px)', color, letterSpacing: '-0.03em', lineHeight: 1.08 }}>{title}</h2>
      <motion.span aria-hidden="true" className="block h-[3px] w-11 rounded-full origin-left mt-1.5 mb-1.5" style={{ background: accent }}
        initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, delay: 0.3, ease: EASE_OUT }} />
      {sub && <p style={{ color: subColor, fontSize: 15, lineHeight: 1.65, fontFamily: bFont ?? hFont, maxWidth: 640 }}>{sub}</p>}
    </MReveal>
  );
}

// Stagger variants for the ad banner slide content
const bannerStagger = { hide: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.12 } } };
const bannerItem = {
  hide: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

function groupByField(items: ProgrammeItem[], field: 'category'): [string, ProgrammeItem[]][] {
  const map = new Map<string, ProgrammeItem[]>();
  for (const item of items) {
    const key = (item[field] || '').trim() || 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === 'General') return 1;
    if (b[0] === 'General') return -1;
    return a[0].localeCompare(b[0]);
  });
}

const LAND_TYPE_LABEL = { course: 'Course', path: 'Learning Path', ve: 'Virtual Experience' } as const;
const LAND_TYPE_GRAD  = {
  course: 'linear-gradient(135deg,#1E3A8A 0%,#3B82F6 100%)',
  path:   'linear-gradient(135deg,#92400E 0%,#F59E0B 100%)',
  ve:     'linear-gradient(135deg,#064E3B 0%,#10B981 100%)',
} as const;
const LAND_C = { card: 'white', text: '#1C1D1F', muted: '#6E7383', faint: '#9CA3AF', cardBorder: '#E8EBEF' };

// Fallback icon for category rows without a tool icon: match by keyword, then by content type
const CATEGORY_ICONS: Array<[RegExp, React.ElementType]> = [
  [/data|analytic|statistic/i,                          BarChart3],
  [/\bai\b|machine|intelligen/i,                        Brain],
  [/market|sales|brand|growth/i,                        Megaphone],
  [/financ|bank|account|invest/i,                       Banknote],
  [/design|creativ|\bux\b|\bui\b/i,                     Palette],
  [/cod|program|develop|software|engineer|web|cloud|tech/i, Code2],
  [/health|medic/i,                                     HeartPulse],
  [/\bhr\b|people|talent|leadership/i,                  Users],
  [/language|communicat|global/i,                       Globe],
  [/automat|productiv/i,                                Zap],
  [/business|consult|strateg|manage/i,                  Briefcase],
];

function getCategoryIcon(title: string, type: 'course' | 've' | 'path'): React.ElementType {
  const hit = CATEGORY_ICONS.find(([re]) => re.test(title));
  if (hit) return hit[1];
  return type === 've' ? Briefcase : type === 'path' ? TrendingUp : GraduationCap;
}

// --- Ad banner carousel ---
type AdCard = { label: string; title: string; description: string; ctaText: string; ctaUrl: string; bgColor: string; bgImage: string; imageLayout?: string; };

const BANNER_AUTO_MS = 6500;

function LandingAdBanner({ ads, hFont, bFont, fullWidth, isDark }: { ads: AdCard[]; hFont?: string; bFont?: string; fullWidth?: boolean; isDark?: boolean }) {
  const cards = ads.filter(a => a.title);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const clipRef  = useRef<HTMLDivElement>(null);
  const touchX   = useRef<number | null>(null);
  const [containerW, setContainerW] = useState(0);
  const GAP = fullWidth ? 0 : 16;
  const max = Math.max(0, cards.length - 1);

  useEffect(() => {
    if (!clipRef.current) return;
    const obs = new ResizeObserver(e => setContainerW(e[0].contentRect.width));
    obs.observe(clipRef.current);
    return () => obs.disconnect();
  }, []);

  // Gentle auto-advance; paused on hover/touch, off for reduced motion
  useEffect(() => {
    if (paused || reduced || max === 0) return;
    const t = setInterval(() => setIdx(i => (i >= max ? 0 : i + 1)), BANNER_AUTO_MS);
    return () => clearInterval(t);
  }, [paused, reduced, max, idx]);

  const isMobile = containerW > 0 && containerW < 640;
  const hasSideImage = cards.some(c => c.imageLayout === 'side' && !!c.bgImage);
  const CARD_W = fullWidth
    ? (containerW > 0 ? containerW : 1280)
    : (containerW > 0 ? Math.min(646, containerW - 40) : 646);
  const CARD_H = fullWidth
    ? (isMobile ? 380 : Math.max(340, Math.min(500, Math.round((containerW || 1280) * 0.34))))
    : (isMobile && hasSideImage)
      ? 430
      : Math.max(220, Math.round(297 * Math.min(1, CARD_W / 646)));

  const totalW = cards.length * CARD_W + (cards.length - 1) * GAP;
  const maxTranslate = containerW > 0 ? Math.max(0, totalW - containerW) : (max * (CARD_W + GAP));
  const getTranslate = (i: number) => i === max ? maxTranslate : i * (CARD_W + GAP);

  const goTo = (next: number) => setIdx(Math.max(0, Math.min(next, max)));

  // Touch swipe (mobile) -- the prev/next arrows are hidden on small screens
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; setPaused(true); };
  const onTouchEnd = (e: React.TouchEvent) => {
    setPaused(false);
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx <= -40) goTo(idx + 1);
    else if (dx >= 40) goTo(idx - 1);
  };

  if (!cards.length) return null;

  return (
    <MReveal y={22} blur>
    <div>
      <div className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}>
        {/* Left arrow - hidden on mobile, vertically centered on desktop */}
        {max > 0 && !isMobile && (
          <button onClick={() => goTo(idx - 1)} disabled={idx === 0} aria-label="Previous slide"
            className={`absolute top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full grid place-items-center transition-all duration-200 hover:scale-110 active:scale-95 disabled:opacity-20 outline-none focus:outline-none ${fullWidth ? 'left-3 sm:left-6 bg-white shadow-md hover:shadow-xl' : isDark ? 'left-0 -translate-x-1/2 hover:bg-white/10' : 'left-0 -translate-x-1/2 hover:bg-white hover:shadow-md'}`}
            style={{ color: !fullWidth && isDark ? 'white' : LAND_C.text }}>
            <ChevronLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>
        )}

        <div ref={clipRef} style={{ overflow: 'hidden', touchAction: 'pan-y' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div ref={trackRef} style={{ display: 'flex', gap: GAP, transform: `translateX(-${getTranslate(idx)}px)`, transition: 'transform 0.65s cubic-bezier(0.22,1,0.36,1)' }}>
          {cards.map((ad, i) => {
            const active = i === idx;
            const contentKey = active ? `on-${idx}` : `off-${i}`;
            if (fullWidth) {
              const isSide = ad.imageLayout === 'side' && !!ad.bgImage;
              const baseColor = ad.bgColor || '#0056D2';
              return (
                <div key={i} className="flex-shrink-0 relative overflow-hidden" style={{ width: CARD_W, height: CARD_H }}>
                  {isSide ? (
                    <>
                      <div className="absolute inset-0" style={{ background: baseColor }} />
                      <div className="absolute top-0 right-0 h-full overflow-hidden" style={{ width: isMobile ? '46%' : '54%' }}>
                        <motion.img key={contentKey} src={ad.bgImage} alt="" className="w-full h-full object-contain object-right"
                          animate={active && !reduced ? { scale: [1, 1.05] } : { scale: 1 }}
                          transition={active && !reduced ? { duration: 8, ease: 'linear' } : { duration: 0.5 }} />
                        <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: '35%', background: `linear-gradient(to right, ${baseColor}, transparent)` }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <motion.div key={`bg-${contentKey}`} className="absolute inset-0"
                        style={{ background: ad.bgImage ? `url(${ad.bgImage}) center/cover no-repeat` : baseColor }}
                        animate={active && !reduced && ad.bgImage ? { scale: [1, 1.06] } : { scale: 1 }}
                        transition={active && !reduced ? { duration: 8, ease: 'linear' } : { duration: 0.5 }} />
                      {ad.bgImage && (
                        <div className="absolute inset-0 pointer-events-none"
                          style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.34) 48%, rgba(0,0,0,0) 82%)' }} />
                      )}
                    </>
                  )}
                  <div className="relative h-full flex items-center max-w-[1240px] mx-auto px-4 sm:px-8 md:px-14">
                    <motion.div key={`panel-${contentKey}`} variants={bannerStagger}
                      initial={active && !reduced ? 'hide' : false} animate="show"
                      style={{ maxWidth: isMobile ? (isSide ? '52%' : '92%') : 620 }}>
                      {ad.label && (
                        <motion.span variants={bannerItem} className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase mb-4"
                          style={{ color: 'rgba(255,255,255,0.85)', letterSpacing: '0.14em' }}>
                          <span aria-hidden="true" className="inline-block w-4 h-[2px] rounded-full" style={{ background: 'rgba(255,255,255,0.85)' }} />
                          {ad.label}
                        </motion.span>
                      )}
                      <motion.h3 variants={bannerItem} className="text-balance leading-[1.12]"
                        style={{ color: 'white', fontFamily: hFont, fontWeight: 500, letterSpacing: '-0.02em', fontSize: isMobile ? 'clamp(26px,8vw,34px)' : 'clamp(34px,4.4vw,56px)' }}>
                        {ad.title}
                      </motion.h3>
                      {ad.description && (
                        <motion.p variants={bannerItem} className="leading-relaxed mt-4"
                          style={{ color: 'rgba(255,255,255,0.88)', fontFamily: bFont ?? hFont, fontSize: isMobile ? 15 : 17, maxWidth: 560 }}>
                          {ad.description}
                        </motion.p>
                      )}
                      {ad.ctaText && (
                        <motion.div variants={bannerItem} className="mt-7">
                          <Link href={ad.ctaUrl || '/auth'}
                            className="group inline-flex items-center gap-2 font-bold rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                            style={{ background: 'white', color: baseColor, fontFamily: hFont, fontSize: isMobile ? 14 : 15, padding: isMobile ? '11px 20px' : '13px 26px' }}>
                            {ad.ctaText}
                            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                          </Link>
                        </motion.div>
                      )}
                    </motion.div>
                  </div>
                </div>
              );
            }
            const isSide = ad.imageLayout === 'side' && !!ad.bgImage;
            const baseColor = ad.bgColor || '#0056D2';
            const padding = isMobile ? '28px 24px' : '36px';
            const body = (
              <>
                <div>
                  {ad.label && (
                    <motion.span variants={bannerItem} className="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-md mb-3"
                      style={{ background: 'rgba(255,255,255,0.22)', color: 'white', letterSpacing: '0.1em', backdropFilter: 'blur(4px)' }}>
                      {ad.label}
                    </motion.span>
                  )}
                  <motion.h3 variants={bannerItem} className="font-black leading-tight mb-2"
                    style={{ color: 'white', fontFamily: hFont, letterSpacing: '-0.025em', fontSize: isMobile ? 'clamp(18px,5vw,24px)' : 'clamp(22px,2.2vw,34px)', maxWidth: isSide ? 'none' : 380 }}>
                    {ad.title}
                  </motion.h3>
                  {!isMobile && (
                    <motion.p variants={bannerItem} className="leading-relaxed"
                      style={{ color: 'rgba(255,255,255,0.80)', fontFamily: bFont ?? hFont, fontSize: 15, maxWidth: isSide ? 'none' : 380 }}>
                      {ad.description}
                    </motion.p>
                  )}
                </div>
                {ad.ctaText && (
                  <motion.div variants={bannerItem} className="mt-4">
                    <Link href={ad.ctaUrl || '/auth'}
                      className="group inline-flex items-center gap-2 self-start font-bold rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                      style={{ background: 'white', color: baseColor, fontFamily: hFont, fontSize: isMobile ? 13 : 14, padding: isMobile ? '10px 18px' : '12px 24px' }}>
                      {ad.ctaText}
                      <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </motion.div>
                )}
              </>
            );
            return (
              <div key={i} className="flex-shrink-0 rounded-2xl overflow-hidden cursor-pointer land-shine-host"
                style={{ width: CARD_W, height: CARD_H }}>
                <div className="relative w-full h-full transition-transform duration-300 hover:scale-[1.02]"
                  style={{ background: isSide ? baseColor : undefined }}>
                {!isSide && (
                  <motion.div key={`bg-${contentKey}`} className="absolute inset-0"
                    style={{ background: ad.bgImage ? `url(${ad.bgImage}) center/cover no-repeat` : baseColor }}
                    animate={active && !reduced && ad.bgImage ? { scale: [1, 1.07] } : { scale: 1 }}
                    transition={active && !reduced ? { duration: 8, ease: 'linear' } : { duration: 0.5 }} />
                )}
                {!isSide && ad.bgImage && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.48)' }} />}
                <span className="land-card-shine" aria-hidden="true" />
                {isSide ? (
                  <motion.div key={contentKey} variants={bannerStagger} initial={active && !reduced ? 'hide' : false} animate="show"
                    className="relative z-10 flex h-full" style={{ height: CARD_H, flexDirection: isMobile ? 'column' : 'row' }}>
                    <div className="flex flex-col justify-between" style={{ flex: 1, minWidth: 0, padding }}>
                      {body}
                    </div>
                    <div style={{ flex: isMobile ? '0 0 50%' : '0 0 44%', position: 'relative', overflow: 'hidden' }}>
                      <img src={ad.bgImage} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: isMobile ? 'contain' : 'cover' }} />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key={contentKey} variants={bannerStagger} initial={active && !reduced ? 'hide' : false} animate="show"
                    className="relative z-10 flex flex-col justify-between h-full" style={{ height: CARD_H, padding }}>
                    {body}
                  </motion.div>
                )}
                </div>
              </div>
            );
          })}
        </div>
        </div>

        {/* Right arrow - hidden on mobile, vertically centered on desktop */}
        {max > 0 && !isMobile && (
          <button onClick={() => goTo(idx + 1)} disabled={idx >= max} aria-label="Next slide"
            className={`absolute top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full grid place-items-center transition-all duration-200 hover:scale-110 active:scale-95 disabled:opacity-20 outline-none focus:outline-none ${fullWidth ? 'right-3 sm:right-6 bg-white shadow-md hover:shadow-xl' : isDark ? 'right-0 translate-x-1/2 hover:bg-white/10' : 'right-0 translate-x-1/2 hover:bg-white hover:shadow-md'}`}
            style={{ color: !fullWidth && isDark ? 'white' : LAND_C.text }}>
            <ChevronRight className="w-5 h-5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Dots centered below -- the active dot fills with the auto-advance timer */}
      {max > 0 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: max + 1 }, (_, i) => {
            const activeDot = i === idx;
            const base = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(28,29,31,0.20)';
            const fill = isDark ? '#ffffff' : LAND_C.text;
            return (
              <button key={i} onClick={() => goTo(i)} aria-label={`Go to slide ${i + 1}`}
                className="relative rounded-full overflow-hidden transition-all duration-300"
                style={{ width: activeDot ? 26 : 7, height: 7, background: base }}>
                {activeDot && !reduced && !paused && (
                  <motion.span key={`fill-${idx}`} aria-hidden="true" className="absolute inset-0 origin-left rounded-full"
                    style={{ background: fill }}
                    initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                    transition={{ duration: BANNER_AUTO_MS / 1000, ease: 'linear' }} />
                )}
                {activeDot && (reduced || paused) && (
                  <span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ background: fill }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
    </MReveal>
  );
}

// Fixed 2-card grid banner (mid-page, no carousel/dots)
function LandingMidAdBanner({ ads, hFont, bFont, isDark }: { ads: AdCard[]; hFont?: string; bFont?: string; isDark?: boolean }) {
  const cards = ads.filter(a => a.title);
  if (!cards.length) return null;
  return (
    <div style={{ background: isDark ? '#0d1117' : '#f4f7f9' }}>
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cards.map((ad, i) => {
            const sideImage = ad.imageLayout === 'side' && !!ad.bgImage;
            const bg = sideImage
              ? (ad.bgColor || '#0056D2')
              : ad.bgImage
                ? `url(${ad.bgImage}) center/cover no-repeat`
                : ad.bgColor || '#0056D2';
            const body = (
              <div className="relative z-10 flex flex-col gap-3" style={{ padding: '28px 32px', minHeight: sideImage ? undefined : 164 }}>
                <div>
                  {ad.label && (
                    <span className="inline-block text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded mb-2.5"
                      style={{ background: 'rgba(255,255,255,0.22)', color: 'white', letterSpacing: '0.1em' }}>
                      {ad.label}
                    </span>
                  )}
                  <h3 className="font-extrabold leading-tight mb-1.5"
                    style={{ color: 'white', fontFamily: hFont, letterSpacing: '-0.02em', fontSize: 'clamp(15px,1.4vw,19px)', maxWidth: sideImage ? 'none' : 240 }}>
                    {ad.title}
                  </h3>
                </div>
                {ad.ctaText && (
                  <div className="mt-1">
                    <Link href={ad.ctaUrl || '/auth'}
                      className="group inline-flex items-center gap-2 self-start font-bold rounded-xl transition-all duration-200 hover:shadow-md active:scale-[0.98]"
                      style={{ background: 'white', color: ad.bgColor || '#0056D2', fontFamily: hFont, fontSize: 13, padding: '10px 20px' }}>
                      {ad.ctaText}
                      <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </div>
                )}
              </div>
            );
            return (
              <MReveal key={i} delay={i * 0.1} y={22}>
                <div className="rounded-2xl overflow-hidden land-shine-host transition-shadow duration-300 hover:shadow-[0_20px_48px_-20px_rgba(2,32,71,0.4)]" style={{ minHeight: 220 }}>
                  <div className="relative w-full h-full transition-transform duration-300 hover:scale-[1.02]"
                    style={{ background: bg, minHeight: 220 }}>
                    {!sideImage && ad.bgImage && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.48)' }} />}
                    <span className="land-card-shine" aria-hidden="true" />
                    {sideImage ? (
                      <div className="relative z-10 flex flex-col sm:flex-row sm:items-stretch" style={{ minHeight: 220 }}>
                        <div className="flex-1 min-w-0">{body}</div>
                        <div className="relative w-full h-44 sm:h-auto sm:w-[44%] flex-shrink-0 overflow-hidden">
                          <img src={ad.bgImage} alt="" className="absolute inset-0 w-full h-full object-contain sm:object-cover" />
                        </div>
                      </div>
                    ) : body}
                  </div>
                </div>
              </MReveal>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Hover popup content for landing page items
function LandingCoursePreview({ item, typeColor, user, hFont, bFont, isDark }: { item: ProgrammeItem; typeColor: string; user: any; hFont?: string; bFont?: string; isDark?: boolean }) {
  // Courses and guided projects have a public page of their own, which now shows a signed-out
  // visitor the cover, the blurb and the price. Learning paths have no such page, so they still
  // route to sign-in.
  const hasPublicPage = item.type === 've' || item.type === 'course';
  const href = hasPublicPage
    ? `/${item.slug}`
    : user ? '/student' : '/auth';
  const desc = item.description.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  if (item.type === 'path') {
    const courses = item.pathCourses ?? [];
    const popupW = Math.min(640, Math.max(360, courses.length * 120 + 32));
    return (
      <div className="rounded-2xl overflow-hidden" style={{ width: popupW, background: isDark ? '#22242d' : 'white', boxShadow: isDark ? '0 4px 28px rgba(0,0,0,0.50)' : '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.05)' }}>
        {/* Path header */}
        <div className="p-4 pb-0">
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md mb-2" style={{ background: typeColor, color: 'white' }}>Learning Path</span>
          <h3 className="text-lg font-bold leading-snug line-clamp-2 mb-1.5" style={{ color: isDark ? 'white' : '#111', fontFamily: hFont }}>{item.title}</h3>
          {desc && <p className="text-sm leading-relaxed line-clamp-2 mb-0" style={{ color: isDark ? 'rgba(255,255,255,0.65)' : '#555', fontFamily: bFont }}>{desc}</p>}
        </div>
        {/* Course list */}
        <div className="p-4">
          {courses.length > 0 ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.45)' : '#888' }}>
                {courses.length} item{courses.length !== 1 ? 's' : ''} in this path
              </p>
              <div className="flex flex-wrap gap-2.5">
                {courses.map(c => (
                  <div key={c.id} className="flex-shrink-0" style={{ width: 110 }}>
                    <div className="rounded-lg overflow-hidden mb-1.5" style={{ aspectRatio: '16/9', background: c.imageUrl ? '#0b0b0d' : (isDark ? '#2c303a' : '#F0F6FF') }}>
                      {c.imageUrl
                        ? <img src={c.imageUrl} alt={c.title} loading="lazy" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><BookOpen className="w-5 h-5" style={{ color: '#9CA3AF' }} /></div>
                      }
                    </div>
                    <p className="text-[11px] font-medium leading-snug line-clamp-2" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : '#333', fontFamily: hFont }}>{c.title}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            desc && <p className="text-sm leading-relaxed line-clamp-3 mb-1" style={{ color: isDark ? 'rgba(255,255,255,0.65)' : '#555', fontFamily: bFont }}>{desc}</p>
          )}
          <Link href={href}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90 mt-4"
            style={{ background: '#00bf63', color: 'white' }}>
            <Play className="w-3.5 h-3.5" />
            {user ? 'Start path' : hasPublicPage ? 'View details' : 'Log in to access'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: isDark ? '#22242d' : 'white', boxShadow: isDark ? '0 4px 28px rgba(0,0,0,0.50)' : '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="relative w-full aspect-video" style={{ background: item.imageUrl ? '#0b0b0d' : 'transparent' }}>
        {item.imageUrl
          ? <img src={item.imageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover"/>
          : <div className="w-full h-full flex items-center justify-center" style={{ background: LAND_TYPE_GRAD[item.type] }}>
              <BookOpen className="w-10 h-10" style={{ color: 'rgba(255,255,255,0.7)' }}/>
            </div>
        }
        <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md"
          style={{ background: typeColor, color: 'white' }}>
          {LAND_TYPE_LABEL[item.type]}
        </span>
      </div>
      <div className="p-5">
        <p className="text-xs mb-1" style={{ color: isDark ? 'rgba(255,255,255,0.45)' : '#888' }}>{LAND_TYPE_LABEL[item.type]}</p>
        <h3 className="text-lg font-bold leading-snug mb-2 line-clamp-2" style={{ color: isDark ? 'white' : '#111', fontFamily: hFont }}>{item.title}</h3>
        {item.partnerName && (
          <div className="flex items-center gap-1.5 mb-2 text-xs" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : '#777' }}>
            {item.partnerLogoUrl && <img src={item.partnerLogoUrl} alt="" className="w-4 h-4 object-contain" />}
            <span>Offered by {item.partnerName}</span>
          </div>
        )}
        {desc && <p className="text-sm leading-relaxed line-clamp-3 mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.65)' : '#555', fontFamily: bFont }}>{desc}</p>}
        {item.difficulty && <p className="text-xs mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.45)' : '#888' }}>{item.difficulty}</p>}
        <Link href={href}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90"
          style={{ background: '#00bf63', color: 'white' }}>
          <Play className="w-3.5 h-3.5"/>
          {user ? 'Start learning' : hasPublicPage ? 'View details' : 'Log in to access'}
        </Link>
      </div>
    </div>
  );
}

function LandingCarouselRow({ title, items, type, typeColor, user, hFont, bFont, isDark, hideTitle, transparentBg, popupDark, bg }: {
  title: string; items: ProgrammeItem[]; type: 'course' | 've' | 'path'; typeColor: string; user: any; hFont?: string; bFont?: string; isDark?: boolean; hideTitle?: boolean; transparentBg?: boolean; popupDark?: boolean; bg?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 380, behavior: 'smooth' });

  const [hover, setHover] = useState<{ item: ProgrammeItem; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };
  const openHover = (item: ProgrammeItem, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const pathW = item.type === 'path' ? Math.min(640, Math.max(360, (item.pathCourses?.length ?? 0) * 120 + 32)) : 320;
    const W = pathW, H = 500;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, W));
    const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, H));
    setHover({ item, left, top, originX, originY });
  };
  useEffect(() => () => cancelClose(), []);

  const toolIcon = useToolIcons();
  const rowBg    = bg ?? (transparentBg ? 'transparent' : (isDark ? '#1E1F26' : 'white'));
  const rowText  = isDark ? 'white' : LAND_C.text;
  const rowMuted = isDark ? 'rgba(255,255,255,0.65)' : LAND_C.muted;
  const rowBorder = isDark ? 'rgba(255,255,255,0.25)' : LAND_C.cardBorder;

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: rowBg }}>
      {(() => {
        const arrowBtn = (dir: number, label: string) => (
          <button onClick={() => scrollByCards(dir)} aria-label={label}
            className="w-9 h-9 rounded-full grid place-items-center transition-all duration-200 hover:scale-105 active:scale-95"
            style={{ border: `1px solid ${rowBorder}`, color: rowMuted }}
            onMouseEnter={e => { e.currentTarget.style.background = rowText; e.currentTarget.style.borderColor = rowText; e.currentTarget.style.color = isDark ? '#111318' : '#ffffff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = rowBorder; e.currentTarget.style.color = rowMuted; }}>
            {dir < 0 ? <ChevronLeft className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
          </button>
        );
        return !hideTitle ? (
          <div className="flex items-center justify-between gap-4 mb-0">
            <MReveal y={14} className="flex items-center gap-2.5 min-w-0">
              {(() => { const icon = toolIcon(title);
                if (icon) return <img src={icon} alt="" className="w-6 h-6 object-contain flex-shrink-0" />;
                const Fallback = getCategoryIcon(title, type);
                return <Fallback className="w-5 h-5 flex-shrink-0" strokeWidth={2.2} style={{ color: rowText }} />;
              })()}
              <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: rowText, fontFamily: hFont }}>{title}</h3>
            </MReveal>
            <div className="flex items-center gap-2 flex-shrink-0">
              {arrowBtn(-1, 'Scroll left')}
              {arrowBtn(1, 'Scroll right')}
            </div>
          </div>
        ) : (
          <div className="flex justify-end mb-0">
            <div className="flex items-center gap-2">
              {arrowBtn(-1, 'Scroll left')}
              {arrowBtn(1, 'Scroll right')}
            </div>
          </div>
        );
      })()}

      <div ref={scrollRef} className="flex flex-nowrap gap-4 overflow-x-auto pt-4 pb-2 snap-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitMaskImage: 'linear-gradient(90deg, #000 94%, transparent)', maskImage: 'linear-gradient(90deg, #000 94%, transparent)' }}>
        {items.map((item, i) => (
          <div key={item.id} className="flex-shrink-0 w-[220px] sm:w-[260px] snap-start"
            onMouseEnter={e => openHover(item, e.currentTarget)}
            onMouseLeave={scheduleClose}>
            <MReveal delay={Math.min(i, 6) * 0.055} y={18}>
              <div className="group cursor-pointer transition-transform duration-300 hover:-translate-y-1">
                <div className="relative rounded-xl overflow-hidden w-full aspect-video transition-shadow duration-300 group-hover:shadow-[0_14px_30px_-12px_rgba(2,32,71,0.45)]"
                  style={{ background: item.imageUrl ? '#0b0b0d' : 'transparent' }}>
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>
                    : <div className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-[1.07]" style={{ background: LAND_TYPE_GRAD[type] }}>
                        <BookOpen className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.7)' }}/>
                      </div>
                  }
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{ background: 'linear-gradient(to top, rgba(1,15,35,0.42), transparent 55%)' }} />
                  <div className="absolute bottom-2 right-2 w-8 h-8 rounded-full grid place-items-center opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 shadow-md pointer-events-none"
                    style={{ background: 'white', color: '#101828' }}>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[15px] font-bold leading-snug mt-2.5 line-clamp-2" style={{ color: rowText, fontFamily: hFont }}>{item.title}</p>
                {item.partnerName && (
                  <div className="flex items-center gap-1.5 mt-1 text-[11px]" style={{ color: rowMuted }}>
                    {item.partnerLogoUrl && <img src={item.partnerLogoUrl} alt="" className="w-4 h-4 object-contain" />}
                    <span>Offered by {item.partnerName}</span>
                  </div>
                )}
                {item.difficulty && <p className="text-[11px] mt-1" style={{ color: rowMuted }}>{item.difficulty}</p>}
              </div>
            </MReveal>
          </div>
        ))}
      </div>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {hover && (
            <HoverPreviewCard
              key={hover.item.id}
              left={hover.left}
              top={hover.top}
              originX={hover.originX}
              originY={hover.originY}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <LandingCoursePreview item={hover.item} typeColor={typeColor} user={user} hFont={hFont} bFont={bFont} isDark={popupDark !== undefined ? popupDark : isDark} />
            </HoverPreviewCard>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}

// --- Modern template ---
function ModernTemplate({ user, profile, scrolled, pastHero, siteConfig, logoUrl, logoDarkUrl, appName, publicSignupEnabled, programmes, programmesError }: {
  user: any; profile: any; scrolled: boolean; pastHero: boolean; siteConfig: SiteConfig; logoUrl: string; logoDarkUrl: string; appName: string;
  publicSignupEnabled: boolean;
  programmes: ProgrammeItem[]; programmesError: boolean;
}) {
  const reduced = useReducedMotion();

  const {
    primaryColor, accentColor, headingFont, bodyFont,
    heroTitle, heroTitleAccent, heroSubheadline, heroPrimaryCta,
    statsEnrolled, statsRating,
    stat1Value, stat1Label, stat2Value, stat2Label, stat3Value, stat3Label, stat4Value, stat4Label,
    partnersLabel, partner1Name, partner1LogoUrl, partner2Name, partner2LogoUrl,
    partner3Name, partner3LogoUrl, partner4Name, partner4LogoUrl,
    partner5Name, partner5LogoUrl, partner6Name, partner6LogoUrl,
    testimonialsLabel, testimonialsHeading,
    testimonial1Name, testimonial1Role, testimonial1Text,
    testimonial2Name, testimonial2Role, testimonial2Text,
    testimonial3Name, testimonial3Role, testimonial3Text,
    ctaHeading, ctaHeadingAccent, ctaSubtext, ctaButton,
    footerTagline, footerLinksHeading,
    footerLink1Label, footerLink1Url, footerLink2Label, footerLink2Url,
    footerLink3Label, footerLink3Url, footerLink4Label, footerLink4Url,
    hideStickyBar, stickyCtaText, stickyCtaButton,
    hideTestimonials, hideCta, hidePartners, hideStats,
    ad1Label, ad1Title, ad1Description, ad1CtaText, ad1CtaUrl, ad1BgColor, ad1BgImage, ad1ImageLayout,
    ad2Label, ad2Title, ad2Description, ad2CtaText, ad2CtaUrl, ad2BgColor, ad2BgImage, ad2ImageLayout,
    ad3Label, ad3Title, ad3Description, ad3CtaText, ad3CtaUrl, ad3BgColor, ad3BgImage, ad3ImageLayout,
    hideAdBanner,
    midAd1Label, midAd1Title, midAd1Description, midAd1CtaText, midAd1CtaUrl, midAd1BgColor, midAd1BgImage, midAd1ImageLayout,
    midAd2Label, midAd2Title, midAd2Description, midAd2CtaText, midAd2CtaUrl, midAd2BgColor, midAd2BgImage, midAd2ImageLayout,
    hideMidAdBanner,
    adBannerFullWidth,
    siteDarkMode,
  } = siteConfig;
  const isPageDark = siteDarkMode === '1';

  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont    ? `'${bodyFont}', sans-serif`    : undefined;

  const headingFontUrl = headingFont && headingFont !== 'Inter'
    ? `https://fonts.googleapis.com/css2?family=${headingFont.replace(/\s+/g, '+')}:wght@400;500;600;700;800;900&display=swap`
    : null;
  const bodyFontUrl = bodyFont && bodyFont !== 'Inter' && bodyFont !== headingFont
    ? `https://fonts.googleapis.com/css2?family=${bodyFont.replace(/\s+/g, '+')}:wght@400;500;600;700;800;900&display=swap`
    : null;

  const NAVY  = '#003262';
  const BLUE  = primaryColor || '#0056D2';
  const AMBER = accentColor  || '#FF9933';
  const GREEN = '#00BF63';

  const courses   = programmes.filter(p => p.type === 'course');
  const paths     = programmes.filter(p => p.type === 'path');
  const ves       = programmes.filter(p => p.type === 've');

  const courseGroups = groupByField(courses, 'category');
  const adCards: AdCard[] = [
    { label: ad1Label, title: ad1Title, description: ad1Description, ctaText: ad1CtaText, ctaUrl: ad1CtaUrl, bgColor: ad1BgColor, bgImage: ad1BgImage, imageLayout: ad1ImageLayout },
    { label: ad2Label, title: ad2Title, description: ad2Description, ctaText: ad2CtaText, ctaUrl: ad2CtaUrl, bgColor: ad2BgColor, bgImage: ad2BgImage, imageLayout: ad2ImageLayout },
    { label: ad3Label, title: ad3Title, description: ad3Description, ctaText: ad3CtaText, ctaUrl: ad3CtaUrl, bgColor: ad3BgColor, bgImage: ad3BgImage, imageLayout: ad3ImageLayout },
  ];
  const midAdCards: AdCard[] = [
    { label: midAd1Label, title: midAd1Title, description: midAd1Description, ctaText: midAd1CtaText, ctaUrl: midAd1CtaUrl, bgColor: midAd1BgColor, bgImage: midAd1BgImage, imageLayout: midAd1ImageLayout },
    { label: midAd2Label, title: midAd2Title, description: midAd2Description, ctaText: midAd2CtaText, ctaUrl: midAd2CtaUrl, bgColor: midAd2BgColor, bgImage: midAd2BgImage, imageLayout: midAd2ImageLayout },
  ];
  const veGroups     = groupByField(ves,     'category');


  const NAV_LINKS: Array<{ label: string; anchor: string }> = [
    { label: 'Courses',              anchor: 'section-courses' },
    { label: 'Learning Paths',       anchor: 'section-paths' },
    { label: 'Virtual Experiences',  anchor: 'section-ves' },
  ];

  return (
    <>
      {headingFontUrl && <link rel="stylesheet" href={headingFontUrl} />}
      {bodyFontUrl    && <link rel="stylesheet" href={bodyFontUrl} />}
    <main className="landing-scope min-h-screen overflow-x-hidden antialiased" style={{ background: isPageDark ? '#0d1117' : '#f4f7f9', fontFamily: bFont }}>

      <style>{`
        .land-shine-host { position: relative; }
        .land-card-shine { position: absolute; top: 0; bottom: 0; left: 0; width: 45%; opacity: 0; pointer-events: none; z-index: 15;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,0.17), transparent);
          transform: translateX(-130%) skewX(-14deg); }
        .land-shine-host:hover .land-card-shine { animation: land-sheen 0.9s ease; }
        @keyframes land-sheen {
          from { opacity: 1; transform: translateX(-130%) skewX(-14deg); }
          to   { opacity: 1; transform: translateX(330%) skewX(-14deg); }
        }
        @media (prefers-reduced-motion: reduce) { .land-card-shine { display: none; } }
      `}</style>

      <LandingScrollProgress from={BLUE} to={AMBER} />

      {/* NAV */}
      <motion.nav
        initial={false} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.55, ease: EASE_OUT }}
        className="fixed top-0 left-0 right-0 z-50 transition-shadow duration-300"
        style={{
          background: scrolled ? (isPageDark ? 'rgba(13,17,23,0.82)' : 'rgba(255,255,255,0.85)') : (isPageDark ? '#0d1117' : 'white'),
          backdropFilter: scrolled ? 'blur(14px) saturate(1.5)' : undefined,
          WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(1.5)' : undefined,
          boxShadow: scrolled ? `0 2px 20px rgba(0,0,0,${isPageDark ? '0.4' : '0.09'})` : 'none',
        }}>
        <div className="max-w-[1240px] mx-auto px-6 md:px-10 h-16 flex items-center">
          <div className="flex items-center gap-2.5 mr-8 flex-shrink-0">
            {logoUrl || logoDarkUrl
              ? <img src={isPageDark ? (logoDarkUrl || logoUrl) : (logoUrl || logoDarkUrl) || undefined} alt={appName} className="h-8 w-auto" />
              : <>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-black flex-shrink-0"
                    style={{ background: BLUE }}>
                    {(appName || 'AI').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-sm font-extrabold hidden sm:block" style={{ color: isPageDark ? 'white' : NAVY, letterSpacing: '-0.02em' }}>
                    {appName}
                  </span>
                </>
            }
          </div>
          <div className="hidden md:flex items-center gap-1 flex-1">
            {NAV_LINKS.map(nl => (
              <button key={nl.anchor}
                onClick={() => document.getElementById(nl.anchor)?.scrollIntoView({ behavior: 'smooth' })}
                className="group relative px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
                {nl.label}
                <span aria-hidden="true"
                  className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                  style={{ background: AMBER }} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            {user ? <NavProfileMenu user={user} profile={profile} pageDark={isPageDark} /> : (
              <>
                <Link href="/auth"
                  className="px-3 sm:px-4 py-2 text-sm font-semibold rounded-md transition-colors"
                  style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isPageDark ? 'rgba(255,255,255,0.08)' : '#F7F9FC'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  Log in
                </Link>
                {publicSignupEnabled && (
                  <Link href="/auth?mode=signup"
                    className="px-3 sm:px-4 py-2 text-sm font-bold rounded-md transition-opacity hover:opacity-90"
                    style={{ background: isPageDark ? '#ffffff' : '#1C1D1F', color: isPageDark ? '#1C1D1F' : '#ffffff' }}>
                    Sign up
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </motion.nav>

      {/* AD BANNER */}
      {hideAdBanner !== '1' && (
        adBannerFullWidth === '1' ? (
          <div className="pt-16 md:pt-20">
            <LandingAdBanner ads={adCards} hFont={hFont} bFont={bFont} fullWidth isDark={isPageDark} />
          </div>
        ) : (
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-10 pb-2 pt-20 md:pt-24">
            <LandingAdBanner ads={adCards} hFont={hFont} bFont={bFont} isDark={isPageDark} />
          </div>
        )
      )}

      <div id="browse" />

      {/* COURSES */}
      {courses.length > 0 && (
        <section id="section-courses" className="py-10 md:py-14">
          <div className="max-w-[1240px] mx-auto px-6 md:px-10">
            <MSectionHeading title="Courses" sub="Level up your skills with interactive and project-based courses."
              color={isPageDark ? 'white' : '#1C1D1F'} subColor={isPageDark ? 'rgba(255,255,255,0.55)' : LAND_C.muted}
              accent={AMBER} hFont={hFont} bFont={bFont} />
            <div className="space-y-4">
              {courseGroups.map(([cat, items]) => (
                <LandingCarouselRow key={cat} title={cat} items={items} type="course" typeColor={BLUE} user={user} hFont={hFont} bFont={bFont} isDark={isPageDark} hideTitle={courseGroups.length === 1} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* LEARNING PATHS */}
      {paths.length > 0 && (
        <section id="section-paths" className="relative py-10 md:py-14 overflow-hidden"
          style={{ background: isPageDark
            ? `linear-gradient(140deg, #0d1117 0%, ${shade(BLUE, -0.72)} 100%)`
            : `linear-gradient(140deg, ${shade(BLUE, -0.4)} 0%, ${BLUE} 62%, ${shade(BLUE, -0.12)} 100%)` }}>
          {!reduced && <>
            <Orb x="78%" y="-40%" size={360} color={shade(BLUE, 0.55)} delay={1} />
            <Orb x="-6%" y="55%" size={320} color={AMBER} delay={3} />
          </>}
          <div className="relative z-10 max-w-[1240px] mx-auto px-6 md:px-10">
            <MSectionHeading title="Learning Paths" sub="Launch your career in tech with curated courses, virtual experiences and guided projects."
              color="white" subColor="rgba(255,255,255,0.75)" accent={AMBER} hFont={hFont} bFont={bFont} />
            <LandingCarouselRow title="Learning Paths" items={paths} type="path" typeColor={AMBER} user={user} hFont={hFont} bFont={bFont} isDark transparentBg={!isPageDark} popupDark={isPageDark} hideTitle
              bg={isPageDark ? `linear-gradient(140deg, rgba(13,17,23,0.55) 0%, ${hexRgba(shade(BLUE, -0.72), 0.55)} 100%)` : undefined} />
          </div>
        </section>
      )}

      {/* MID-PAGE AD BANNER */}
      {hideMidAdBanner !== '1' && midAdCards.some(a => a.title) && (
        <LandingMidAdBanner ads={midAdCards} hFont={hFont} bFont={bFont} isDark={isPageDark} />
      )}

      {/* VIRTUAL EXPERIENCES */}
      {ves.length > 0 && (
        <section id="section-ves" className="py-10 md:py-14">
          <div className="max-w-[1240px] mx-auto px-6 md:px-10">
            <MSectionHeading title="Virtual Experiences" sub="Gain job-ready skills with virtual internship programs and projects to build your portfolio."
              color={isPageDark ? 'white' : '#1C1D1F'} subColor={isPageDark ? 'rgba(255,255,255,0.55)' : LAND_C.muted}
              accent={AMBER} hFont={hFont} bFont={bFont} />
            <div className="space-y-4">
              {veGroups.map(([ind, items]) => (
                <LandingCarouselRow key={ind} title={ind} items={items} type="ve" typeColor={GREEN} user={user} hFont={hFont} bFont={bFont} isDark={isPageDark} hideTitle={veGroups.length === 1} />
              ))}
            </div>
          </div>
        </section>
      )}

      {programmesError && <ProgrammeLoadError dark={isPageDark} />}

      {!programmesError && programmes.length === 0 && (
        <div className="min-h-[40vh] flex items-center justify-center text-sm" style={{ color: isPageDark ? 'rgba(255,255,255,0.40)' : '#6E7383' }}>
          No programmes yet. Check back soon.
        </div>
      )}

      {/* CTA SECTION */}
      {hideCta !== '1' && (
        <section className="relative py-20 md:py-28 text-center overflow-hidden"
          style={{ background: `linear-gradient(140deg, ${shade(BLUE, -0.62)} 0%, ${BLUE} 72%, ${shade(BLUE, -0.1)} 100%)` }}>
          {!reduced && <>
            <Orb x="-8%" y="-30%" size={430} color={shade(BLUE, 0.4)} delay={0} />
            <Orb x="72%" y="40%" size={380} color={AMBER} delay={2.5} />
          </>}
          <div className="relative z-10 max-w-[1240px] mx-auto px-6 md:px-10">
            <h2 className="mb-4" style={{ fontFamily: hFont, fontWeight: 900, fontSize: 'clamp(30px,4.2vw,50px)', color: 'white', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              <WordReveal text={ctaHeading || `Join ${statsEnrolled || '10,000+'} professionals`} /><br />
              <WordReveal text={ctaHeadingAccent || "building Africa's future."} delay={0.25} style={{ color: AMBER }} />
            </h2>
            <MReveal delay={0.35} y={16}>
              <p className="mx-auto mb-9 text-base" style={{ color: 'rgba(255,255,255,0.72)', maxWidth: 500, lineHeight: 1.7, fontFamily: bFont ?? hFont }}>
                {ctaSubtext || 'Start learning today. No credit card required. Access your first course free.'}
              </p>
            </MReveal>
            <MReveal delay={0.45} y={14}>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Magnetic>
                  <Link href={user ? '/student' : '/auth?mode=signup'}
                    className="group inline-flex items-center gap-2 font-bold rounded-xl transition-shadow duration-300 hover:shadow-[0_16px_40px_-10px_rgba(0,0,0,0.45)]"
                    style={{ background: 'white', color: BLUE, padding: '14px 32px', fontSize: 15 }}>
                    {user ? 'Go to my learning' : (ctaButton || 'Start learning free')}
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Magnetic>
                <a href="#browse"
                  className="inline-flex items-center font-bold rounded-xl transition-all"
                  style={{ padding: '13px 30px', fontSize: 15, color: 'white', border: '2px solid rgba(255,255,255,0.32)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'white'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.32)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  Explore programmes
                </a>
              </div>
            </MReveal>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <footer style={{ background: isPageDark ? '#0D1117' : (primaryColor || '#0056D2') }}>
        <div className="max-w-[1240px] mx-auto px-6 md:px-10 pt-12 pb-9">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
            <MReveal y={18} className="col-span-2 md:col-span-1">
              <div className="text-sm font-extrabold mb-2.5" style={{ color: 'white', letterSpacing: '-0.02em' }}>{appName}</div>
              <p className="text-sm leading-relaxed max-w-[240px]" style={{ color: 'rgba(255,255,255,0.38)' }}>{footerTagline}</p>
            </MReveal>
            <MReveal y={18} delay={0.1}>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-3.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {footerLinksHeading || 'Learn'}
              </div>
              <div className="flex flex-col gap-2.5 items-start">
                {[
                  [footerLink1Label || 'Courses',               footerLink1Url || '/auth'],
                  [footerLink2Label || 'Learning Paths',        footerLink2Url || '/auth'],
                  [footerLink3Label || 'Virtual Experiences',   footerLink3Url || '/auth'],
                  [footerLink4Label || 'Certificates',          footerLink4Url || '/auth'],
                ].filter(([l]) => l).map(([label, href]) => (
                  <Link key={label} href={href} className="text-sm inline-block transition-all duration-200 hover:translate-x-1"
                    style={{ color: 'rgba(255,255,255,0.40)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'white'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.40)'; }}>
                    {label}
                  </Link>
                ))}
              </div>
            </MReveal>
            <MReveal y={18} delay={0.18}>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-3.5" style={{ color: 'rgba(255,255,255,0.45)' }}>Account</div>
              <div className="flex flex-col gap-2.5 items-start">
                {([
                  ['Log in',      '/auth'],
                  ['Sign up',     '/auth?mode=signup'],
                  ['Dashboard',   user ? '/student' : '/auth'],
                  ['Leaderboard', user ? '/student' : '/auth'],
                ] as const).map(([label, href]) => (
                  <Link key={label} href={href} className="text-sm inline-block transition-all duration-200 hover:translate-x-1"
                    style={{ color: 'rgba(255,255,255,0.40)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'white'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.40)'; }}>
                    {label}
                  </Link>
                ))}
              </div>
            </MReveal>
          </div>
          <div className="flex items-center justify-between pt-6 flex-wrap gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.24)' }}>
              &copy; {new Date().getFullYear()} {appName}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>


    </main>
    </>
  );
}

// --- Landing page skeleton ---
function LandingPageSkeleton() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0f0f0f' }}>
      {/* Nav */}
      <div className="h-16 px-6 flex items-center justify-between border-b border-white/5">
        <div className="h-8 w-32 rounded-lg bg-white/10 animate-pulse" />
        <div className="h-8 w-24 rounded-xl bg-white/10 animate-pulse" />
      </div>
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-16 gap-6">
        <div className="h-3 w-28 rounded-full bg-white/10 animate-pulse" />
        <div className="space-y-3 w-full max-w-2xl">
          <div className="h-10 rounded-xl bg-white/10 animate-pulse" />
          <div className="h-10 w-3/4 mx-auto rounded-xl bg-white/10 animate-pulse" />
        </div>
        <div className="space-y-2 w-full max-w-lg">
          <div className="h-3 rounded-full bg-white/10 animate-pulse" />
          <div className="h-3 w-5/6 mx-auto rounded-full bg-white/10 animate-pulse" />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <div className="h-12 w-40 rounded-2xl bg-white/10 animate-pulse" />
          <div className="h-12 w-36 rounded-2xl bg-white/10 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// --- Page ---
type LandingPageClientProps = {
  initialTemplateId: string;
  initialSiteConfig: Partial<SiteConfig>;
  initialProgrammes: ProgrammeItem[];
  programmesError: boolean;
  isPreview: boolean;
};

export default function LandingPageClient({
  initialTemplateId,
  initialSiteConfig,
  initialProgrammes,
  programmesError,
  isPreview,
}: LandingPageClientProps) {
  const { logoUrl, logoDarkUrl, appName, publicSignupEnabled } = useTenant();

  const [user, setUser]         = useState<any>(null);
  const [profile, setProfile]   = useState<any>(null);
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [loading, setLoading]   = useState(isPreview);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(() => resolveConfig(initialTemplateId, initialSiteConfig));
  const [templateId, setTemplateId] = useState(initialTemplateId);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isPreview) return;

    // Dashboard preview config must override the server-rendered settings.
    try {
      const raw = localStorage.getItem('_site_preview');
      if (raw) {
        const { template, config } = JSON.parse(raw);
        const nextTemplate = template ?? 'modern';
        setTemplateId(nextTemplate);
        setSiteConfig(resolveConfig(nextTemplate, config ?? {}));
      }
    } catch {}
    setLoading(false);
  }, [isPreview]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Live preview: receive config updates from dashboard iframe via postMessage
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'preview-config') {
        const t = e.data.template ?? 'modern';
        setTemplateId(t);
        setSiteConfig(resolveConfig(t, e.data.config ?? {}));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    // Redirect to password reset if Supabase fires a PASSWORD_RECOVERY event
    // (happens when the recovery email link uses implicit flow and the hash
    // fragment lands on this page instead of /auth/callback).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        window.location.href = '/auth/reset-password';
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        const { data } = await supabase
          .from('students')
          .select('username, role, full_name, avatar_url')
          .eq('id', u.id)
          .single();
        setProfile(data);
      }
    });
    const onScroll = () => {
      setScrolled(window.scrollY > 40);
      setPastHero(window.scrollY > window.innerHeight * 0.75);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setActiveTestimonial(v => (v + 1) % 3), 5000);
    return () => clearInterval(id);
  }, []);

  const {
    primaryColor, accentColor, headingFont, bodyFont,
    heroTitle, heroTitleAccent, heroSubheadline, heroPrimaryCta, heroFontSize, heroOverlayColor, heroOverlayOpacity, statsEnrolled, statsRating,
    offeringsLabel, offeringsHeading, offeringsHeadingAccent, offeringsSubtext,
    offering1Title, offering1Description, offering1Badge,
    offering2Title, offering2Description, offering2Badge,
    offering3Title, offering3Description, offering3Badge,
    offering4Title, offering4Description, offering4Badge,
    stepsLabel, stepsHeading, stepsHeadingAccent,
    step1Title, step1Body, step2Title, step2Body, step3Title, step3Body,
    featuresLabel, featuresHeading, featuresHeadingAccent, featuresSubtext, featuresCta,
    highlight1, highlight2, highlight3, highlight4, highlight5, highlight6, highlight7, highlight8,
    testimonialsLabel, testimonialsHeading,
    testimonial1Name, testimonial1Role, testimonial1Text,
    testimonial2Name, testimonial2Role, testimonial2Text,
    testimonial3Name, testimonial3Role, testimonial3Text,
    ctaHeading, ctaHeadingAccent, ctaSubtext, ctaButton,
    footerTagline,
    hideOfferings, hideSteps, hideFeatures, hideTestimonials, hideCta,
    stickyCtaText, stickyCtaButton, hideStickyBar,
    footerLinksHeading, footerLink1Label, footerLink1Url,
    footerLink2Label, footerLink2Url, footerLink3Label, footerLink3Url,
    footerLink4Label, footerLink4Url,
    footerBgImageUrl, footerOverlayColor, footerOverlayOpacity,
    floatingCtaHeading, floatingCtaSubtext, floatingCtaButton, floatingCtaImageUrl, floatingCtaBgColor, hideFloatingCta,
  } = siteConfig;

  const footerOvRgb = (() => {
    const c = footerOverlayColor || '#000000';
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return `${r},${g},${b}`;
  })();
  const footerOvAlpha = parseFloat(footerOverlayOpacity || '70') / 100;

  // Load Google Fonts for chosen typefaces
  useEffect(() => {
    [headingFont, bodyFont].forEach(f => {
      if (!f || f === 'Inter') return;
      const id = `gf-${f.replace(/\s+/g, '-').toLowerCase()}`;
      if (document.getElementById(id)) return;
      const link = document.createElement('link');
      link.id = id; link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${f.replace(/\s+/g, '+')}:wght@400;500;600;700;800;900&display=swap`;
      document.head.appendChild(link);
    });
  }, [headingFont, bodyFont]);

  const hFont = headingFont ? `'${headingFont}', sans-serif` : undefined;
  const bFont = bodyFont    ? `'${bodyFont}', sans-serif`    : undefined;

  if (loading) return <LandingPageSkeleton />;

  if (templateId === 'elevate') {
    return <ElevateTemplate user={user} profile={profile} scrolled={scrolled} pastHero={pastHero} siteConfig={siteConfig} logoUrl={logoUrl} logoDarkUrl={logoDarkUrl} appName={appName} publicSignupEnabled={publicSignupEnabled} programmes={initialProgrammes} programmesError={programmesError} />;
  }

  return <ModernTemplate user={user} profile={profile} scrolled={scrolled} pastHero={pastHero} siteConfig={siteConfig} logoUrl={logoUrl} logoDarkUrl={logoDarkUrl} appName={appName} publicSignupEnabled={publicSignupEnabled} programmes={initialProgrammes} programmesError={programmesError} />;

}
