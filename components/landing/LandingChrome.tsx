'use client';

/**
 * The landing page's own navigation bar and footer, lifted out so other public pages wear the
 * same chrome instead of a lookalike. The markup is the Modern template's, unchanged; only the
 * values it used to read from the page's scope arrive as props now.
 *
 * The one behavioural difference is the section links. On the landing page they scroll to a
 * heading; anywhere else those headings do not exist, so a caller passes navLinkHref and they
 * become ordinary links home.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useInView, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { LayoutDashboard, ChevronDown, User, Settings, LogOut, Award, GraduationCap } from 'lucide-react';

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

function Reveal({ children, delay = 0, y = 26, className = '' }: {
  children: React.ReactNode; delay?: number; y?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduced = useReducedMotion();
  return (
    <motion.div ref={ref} initial={false}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={reduced ? { duration: 0 } : { duration: 0.7, delay, ease: EASE_OUT }}
      className={className}>
      {children}
    </motion.div>
  );
}

/** A section link: a scroll button on the landing page, a link home anywhere else. */
function NavSectionLink({ anchor, hrefFor, className, style, children }: {
  anchor: string; hrefFor?: (anchor: string) => string;
  className?: string; style?: React.CSSProperties; children: React.ReactNode;
}) {
  if (hrefFor) {
    return <Link href={hrefFor(anchor)} className={className} style={style}>{children}</Link>;
  }
  return (
    <button
      onClick={() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' })}
      className={className}
      style={style}
    >
      {children}
    </button>
  );
}

export interface LandingNavProps {
  appName: string;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  isPageDark?: boolean;
  scrolled: boolean;
  user: any;
  profile: any;
  publicSignupEnabled: boolean;
  primaryColor?: string;
  accentColor?: string;
  navLinks: Array<{ label: string; anchor: string }>;
  /** Supply to turn the section links into ordinary links, for pages without those sections. */
  navLinkHref?: (anchor: string) => string;
}

export interface LandingFooterProps {
  appName: string;
  isPageDark?: boolean;
  primaryColor?: string;
  user: any;
  footerTagline?: string;
  footerLinksHeading?: string;
  footerLink1Label?: string; footerLink1Url?: string;
  footerLink2Label?: string; footerLink2Url?: string;
  footerLink3Label?: string; footerLink3Url?: string;
  footerLink4Label?: string; footerLink4Url?: string;
}

// --- Nav profile menu ---
export function NavProfileMenu({ user, profile, pageDark }: { user: any; profile: any; pageDark?: boolean }) {
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

export function LandingNav({
  appName, logoUrl, logoDarkUrl, isPageDark, scrolled, user, profile,
  publicSignupEnabled, primaryColor, accentColor, navLinks, navLinkHref,
}: LandingNavProps) {
  const NAVY  = '#003262';
  const BLUE  = primaryColor || '#0056D2';
  const AMBER = accentColor  || '#FF9933';
  return (
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
              ? <img src={(isPageDark ? (logoDarkUrl || logoUrl) : (logoUrl || logoDarkUrl)) ?? undefined} alt={appName} className="h-8 w-auto" />
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
            {navLinks.map(nl => (
              <NavSectionLink key={nl.anchor} anchor={nl.anchor} hrefFor={navLinkHref}
                className="group relative px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
                {nl.label}
                <span aria-hidden="true"
                  className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                  style={{ background: AMBER }} />
              </NavSectionLink>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            <Link href="/pricing"
              className="px-3 sm:px-4 py-2 text-sm font-semibold rounded-md transition-colors"
              style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
              Pricing
            </Link>
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
  );
}

export function LandingFooter({
  appName, isPageDark, primaryColor, user, footerTagline, footerLinksHeading,
  footerLink1Label, footerLink1Url, footerLink2Label, footerLink2Url,
  footerLink3Label, footerLink3Url, footerLink4Label, footerLink4Url,
}: LandingFooterProps) {
  return (
      <footer style={{ background: isPageDark ? '#0D1117' : (primaryColor || '#0056D2') }}>
        <div className="max-w-[1240px] mx-auto px-6 md:px-10 pt-12 pb-9">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
            <Reveal y={18} className="col-span-2 md:col-span-1">
              <div className="text-sm font-extrabold mb-2.5" style={{ color: 'white', letterSpacing: '-0.02em' }}>{appName}</div>
              <p className="text-sm leading-relaxed max-w-[240px]" style={{ color: 'rgba(255,255,255,0.38)' }}>{footerTagline}</p>
            </Reveal>
            <Reveal y={18} delay={0.1}>
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
            </Reveal>
            <Reveal y={18} delay={0.18}>
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
            </Reveal>
          </div>
          <div className="flex items-center justify-between pt-6 flex-wrap gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.24)' }}>
              &copy; {new Date().getFullYear()} {appName}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
  );
}
