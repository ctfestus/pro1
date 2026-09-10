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
import { LayoutDashboard, ChevronDown, ChevronRight, User, Settings, LogOut, Award, GraduationCap } from 'lucide-react';

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
function NavSectionLink({ anchor, hrefFor, className, style, onNavigate, children }: {
  anchor: string; hrefFor?: (anchor: string) => string;
  className?: string; style?: React.CSSProperties; children: React.ReactNode;
  /** Runs when the link is followed. The megamenu uses it to close itself. */
  onNavigate?: () => void;
}) {
  if (hrefFor) {
    return <Link href={hrefFor(anchor)} className={className} style={style} onClick={onNavigate}>{children}</Link>;
  }
  return (
    <button
      onClick={() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
        onNavigate?.();
      }}
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
  fontFamily?: string;
  navLinks: Array<{ label: string; anchor: string; subGroups?: NavSubGroup[] }>;
  /** Supply to turn the section links into ordinary links, for pages without those sections. */
  navLinkHref?: (anchor: string) => string;
  /**
   * Collapse the section links into a single megamenu trigger with this label. Without it they
   * render flat, which is what a page with no content to preview still wants.
   */
  navMenuLabel?: string;
}

export interface LandingFooterProps {
  appName: string;
  isPageDark?: boolean;
  primaryColor?: string;
  fontFamily?: string;
  user: any;
  footerTagline?: string;
  footerLinksHeading?: string;
  footerLink1Label?: string; footerLink1Url?: string;
  footerLink2Label?: string; footerLink2Url?: string;
  footerLink3Label?: string; footerLink3Url?: string;
  footerLink4Label?: string; footerLink4Url?: string;
}

// --- Nav profile menu ---
export function NavProfileMenu({ user, profile, pageDark, fontFamily }: {
  user: any;
  profile: any;
  pageDark?: boolean;
  fontFamily?: string;
}) {
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
              fontFamily: fontFamily || "'Inter', sans-serif",
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

/** One row of the megamenu's right-hand panel. Built by the caller so this file stays chrome. */
export type NavMenuItem = { id: string; title: string; imageUrl?: string; href: string };

/**
 * A content type's own grouping: the tools for courses (AI, Excel and so on), the industry for a
 * virtual experience, Career or Technology for a certification. Same grouping the page's own rows
 * use. An empty label means the type has none, and the middle column is then skipped.
 */
export type NavSubGroup = { label: string; items: NavMenuItem[] };

/**
 * One "Learn" trigger in place of a link per content type. Four flat links crowded the bar and
 * still only offered a scroll; this previews what is actually in each section.
 *
 * Hovering a type on the left swaps the panel on the right, and clicking it goes to that section
 * -- so a device with no hover still gets exactly what the flat links did. The panel also opens
 * on the first type rather than empty, and the trigger toggles on click as well as hover, which
 * is what makes it usable on a tablet, where the bar is visible but hover is not.
 */
function NavLearnMenu({ label, groups, hrefFor, isPageDark, accentColor, fontFamily }: {
  label: string;
  groups: Array<{ label: string; anchor: string; subGroups?: NavSubGroup[] }>;
  hrefFor?: (anchor: string) => string;
  isPageDark?: boolean; accentColor: string; fontFamily?: string;
}) {
  const [open, setOpen]     = useState(false);
  const [active, setActive] = useState(0);
  const [activeSub, setActiveSub] = useState(0);
  // Picking a type has to reset the grouping, or the panel keeps an index that belongs to the
  // type you just left and shows the wrong set.
  const selectType = (i: number) => { setActive(i); setActiveSub(0); };
  const reduced    = useReducedMotion();
  const wrapRef    = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose   = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => cancelClose(), []);

  // An open panel that outlives the pointer sits over the page and swallows clicks meant for the
  // hero, so Escape closes it and so does a press anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const text   = isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F';
  const strong = isPageDark ? '#ffffff' : '#1C1D1F';
  const muted  = isPageDark ? 'rgba(255,255,255,0.55)' : '#6E7383';
  const panel  = isPageDark ? '#161b22' : '#ffffff';
  const inset  = isPageDark ? 'rgba(255,255,255,0.06)' : '#F4F7F9';
  const hair   = isPageDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #E8EBEF';

  const current   = groups[Math.min(active, groups.length - 1)];
  const subGroups = current?.subGroups ?? [];
  // Learning paths carry no grouping of their own, so the middle column is dropped for them and
  // the items take the space instead.
  const showSubs  = subGroups.some(group => group.label);
  const currentSub = subGroups[Math.min(activeSub, Math.max(0, subGroups.length - 1))];
  const items      = currentSub?.items ?? [];

  return (
    <div ref={wrapRef} className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}>
      <button type="button" onClick={() => setOpen(v => !v)}
        aria-expanded={open} aria-haspopup="true"
        className="group relative flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors"
        style={{ color: text, fontFamily }}>
        {label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        <span aria-hidden="true"
          className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full origin-left transition-transform duration-300"
          style={{ background: accentColor, transform: open ? 'scaleX(1)' : 'scaleX(0)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: EASE_OUT }}
            className="absolute left-0 top-full mt-2 rounded-2xl overflow-hidden flex"
            style={{
              // The panel hangs from the trigger, which sits roughly 200px in past the logo, so
              // the viewport subtraction has to cover that offset or a narrow window pushes the
              // right-hand edge off screen.
              width: 'min(1060px, calc(100vw - 220px))', background: panel, border: hair,
              // A floor, not a ceiling. There are only ever a few content types, so the first
              // column runs out well before the items do; leaving space under it is preferable to
              // capping the height and making the items scroll.
              minHeight: 420,
              boxShadow: isPageDark ? '0 24px 60px rgba(0,0,0,0.55)' : '0 24px 60px -24px rgba(16,24,40,0.28)',
              fontFamily,
            }}>

            {/* Left: the content types */}
            <div className="flex-shrink-0 p-3" style={{ width: 246, background: inset }}>
              {/* Hover and focus live on the wrapper, not on a span inside the link: a span is
                  not focusable, so keyboard users could never swap the panel. React's onFocus
                  bubbles, so tabbing onto the link itself selects the type. */}
              {groups.map((group, i) => (
                <div key={group.anchor} onMouseEnter={() => selectType(i)} onFocus={() => selectType(i)}>
                  <NavSectionLink anchor={group.anchor} hrefFor={hrefFor} onNavigate={() => setOpen(false)}
                    className="w-full flex items-center gap-2 text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                    style={{
                      color: i === active ? strong : muted,
                      background: i === active ? panel : 'transparent',
                    }}>
                    <span className="flex-1">{group.label}</span>
                    <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ opacity: i === active ? 1 : 0.4 }} />
                  </NavSectionLink>
                </div>
              ))}
            </div>

            {/* The selected type's own grouping: tools for courses, industry for an experience,
                Career or Technology for a certification. Hovering one swaps the items. */}
            {showSubs && (
              <div className="flex-shrink-0 p-3 overflow-y-auto" style={{ width: 218, borderRight: hair }}>
                {subGroups.map((group, i) => (
                  <button key={group.label || i} type="button"
                    onMouseEnter={() => setActiveSub(i)} onFocus={() => setActiveSub(i)}
                    onClick={() => setActiveSub(i)}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors"
                    style={{
                      color: i === activeSub ? strong : muted,
                      background: i === activeSub ? inset : 'transparent',
                    }}>
                    <span className="flex-1 min-w-0 truncate">{group.label}</span>
                    <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ opacity: i === activeSub ? 1 : 0.35 }} />
                  </button>
                ))}
              </div>
            )}

            {/* Right: what the selected section actually holds */}
            <div className="flex-1 min-w-0 p-5">
              {items.length === 0 ? (
                <p className="text-sm px-1 py-2" style={{ color: muted }}>Nothing published here yet.</p>
              ) : (
                <>
                  {/* Two across: the type list and its grouping take the first two columns, so
                      these are the last two. */}
                  <div className="grid grid-cols-2 gap-2">
                    {items.map(item => (
                      <Link key={item.id} href={item.href} onClick={() => setOpen(false)}
                        className="flex items-center gap-3 p-2 rounded-xl transition-colors"
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = inset; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        {/* Not every item has a cover. Without a mark in its place the row reads
                            as a thumbnail that failed to load rather than one that never existed. */}
                        <span className="flex-shrink-0 rounded-lg overflow-hidden grid place-items-center" style={{ width: 76, height: 50, background: inset }}>
                          {item.imageUrl
                            ? <img src={item.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                            : <GraduationCap className="w-5 h-5" style={{ color: muted }} />}
                        </span>
                        <span className="text-[13px] font-semibold leading-snug line-clamp-3" style={{ color: strong }}>
                          {item.title}
                        </span>
                      </Link>
                    ))}
                  </div>
                  {/* Plain text colour, not the accent: the accent is the tenant's secondary and
                      reads as a coloured call to action competing with the items above it. */}
                  <NavSectionLink anchor={current.anchor} hrefFor={hrefFor} onNavigate={() => setOpen(false)}
                    className="inline-flex items-center gap-1 mt-4 ml-2 text-[13px] font-bold transition-opacity hover:opacity-70"
                    style={{ color: strong }}>
                    See all {current.label.toLowerCase()}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </NavSectionLink>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LandingNav({
  appName, logoUrl, logoDarkUrl, isPageDark, scrolled, user, profile,
  publicSignupEnabled, primaryColor, accentColor, fontFamily, navLinks, navLinkHref, navMenuLabel,
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
          fontFamily,
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
            {navMenuLabel && navLinks.length > 0 ? (
              <NavLearnMenu label={navMenuLabel} groups={navLinks} hrefFor={navLinkHref}
                isPageDark={isPageDark} accentColor={AMBER} fontFamily={fontFamily} />
            ) : navLinks.map(nl => (
              <NavSectionLink key={nl.anchor} anchor={nl.anchor} hrefFor={navLinkHref}
                className="group relative px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
                {nl.label}
                <span aria-hidden="true"
                  className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                  style={{ background: AMBER }} />
              </NavSectionLink>
            ))}
            {/* Sits with the section navigation rather than beside the account controls, and is
                styled as a nav link so it matches what it now stands next to. */}
            <Link href="/pricing"
              className="group relative px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
              Pricing
              <span aria-hidden="true"
                className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                style={{ background: AMBER }} />
            </Link>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            {/* The row above is hidden below md, so without a copy here Pricing would disappear
                on a phone entirely -- there is no mobile section nav to fall back to. */}
            <Link href="/pricing"
              className="md:hidden px-3 sm:px-4 py-2 text-sm font-semibold rounded-md transition-colors"
              style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
              Pricing
            </Link>
            {user ? <NavProfileMenu user={user} profile={profile} pageDark={isPageDark} fontFamily={fontFamily} /> : (
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
  appName, isPageDark, primaryColor, fontFamily, user, footerTagline, footerLinksHeading,
  footerLink1Label, footerLink1Url, footerLink2Label, footerLink2Url,
  footerLink3Label, footerLink3Url, footerLink4Label, footerLink4Url,
}: LandingFooterProps) {
  return (
      <footer style={{ background: isPageDark ? '#0D1117' : (primaryColor || '#0056D2'), fontFamily }}>
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
