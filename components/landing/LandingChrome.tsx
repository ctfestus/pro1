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
import { createElement, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { ChevronDown, ChevronRight, Menu, X, GraduationCap } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Briefcase, CalendarDots, Certificate, MonitorPlay, Package, Signpost, type Icon } from '@phosphor-icons/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { CategoryIcon } from '@/components/CategoryIcon';
import type { NavSubGroup } from '@/lib/landing-nav';
import { ProfileMenu } from '@/components/ProfileMenu';
import type { ProgrammeItem } from '@/lib/get-landing-page-data';
import { M3, GUTTER } from '@/components/landing/type';

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** A section link: a scroll button on the landing page, a link home anywhere else. */
function NavSectionLink({ anchor, hrefFor, className, style, onNavigate, children }: {
  anchor: string; hrefFor?: (anchor: string) => string;
  className?: string; style?: React.CSSProperties; children: React.ReactNode;
  /** Runs when the link is followed. The megamenu uses it to close itself. */
  onNavigate?: () => void;
}) {
  // An anchor that is already a path (the store's /books) is a page of its own, never a section.
  if (anchor.startsWith('/') || hrefFor) {
    return <Link href={anchor.startsWith('/') ? anchor : hrefFor!(anchor)} className={className} style={style} onClick={onNavigate}>{children}</Link>;
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

/**
 * Move selection with the arrow keys inside one of the megamenu's columns, and take focus with it.
 *
 * Selecting on focus instead looks right with a mouse and traps a keyboard: every Tab moved to the
 * next row AND replaced the panel, so Tab could only ever arrive at the last row's items and the
 * earlier ones were unreachable. With one row focusable at a time, Tab leaves the column and lands
 * in the items that belong to the selection, which is the whole point of the column.
 */
function handleRovingKeys(
  e: React.KeyboardEvent,
  containerRef: React.RefObject<HTMLDivElement | null>,
  count: number, current: number, select: (i: number) => void,
) {
  const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const back    = e.key === 'ArrowUp'   || e.key === 'ArrowLeft';
  if (!forward && !back) return;
  e.preventDefault();
  const next = forward ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
  select(next);
  // Read here, in the event, never during render. The marker sits on a wrapper in one column and
  // on the control itself in the other.
  const row = containerRef.current?.querySelectorAll<HTMLElement>('[data-roving-row]')[next];
  const target = row?.matches('a, button') ? row : row?.querySelector<HTMLElement>('a, button');
  target?.focus();
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
  /** What the site offers, so a link to a section with nothing in it is left out. */
  programmes: ProgrammeItem[];
}


/**
 * One "Learn" trigger in place of a link per content type. Four flat links crowded the bar and
 * still only offered a scroll; this previews what is actually in each section.
 *
 * Clicking a type on the left swaps the panel on the right; its See all button goes to that
 * section. Selecting on click, not hover, keeps the panel steady while the pointer crosses the
 * other rows on its way to the items. The panel opens on the first type rather than empty, and
 * the trigger toggles on click as well as hover, which makes it usable on a tablet.
 */
/** Each kind of content in the Learn menu, by the page it links to: its icon and one line. */
const TYPE_META: Record<string, { icon: Icon; line: string }> = {
  '/courses': { icon: MonitorPlay, line: 'Interactive, project-based courses.' },
  '/learning-paths': { icon: Signpost, line: 'Guided routes from first steps to job-ready.' },
  '/virtual-experiences': { icon: Briefcase, line: 'Work on real business problems and build a portfolio.' },
  '/certifications': { icon: Certificate, line: 'Timed exams that end in a credential you can share.' },
  '/products': { icon: Package, line: 'Guides and resources to download and keep.' },
  '/events': { icon: CalendarDots, line: 'Live sessions, workshops and meetups.' },
};

type MenuGroup = { label: string; anchor: string; subGroups?: NavSubGroup[] };

/** A kind's icon, plain (no tile), in the row's own text colour. */
function TypeTile({ anchor, size = 20 }: { anchor: string; size?: number }) {
  const glyph = TYPE_META[anchor]?.icon;
  return glyph ? createElement(glyph, { className: 'flex-shrink-0', style: { width: size, height: size }, weight: 'duotone', 'aria-hidden': true }) : null;
}

/** A grouping chip (AI, Fintech...) with its icon, the chosen one in the primary blue. */
function GroupChip({ label, on, onClick, inset, muted }: { label: string; on: boolean; onClick: () => void; inset: string; muted: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors"
      style={{ background: on ? '#3E93FF' : inset, color: on ? '#ffffff' : muted }}>
      <CategoryIcon name={label} className="h-3.5 w-3.5" />{label}
    </button>
  );
}

/** A small item card: the cover (16:9) and the title. */
function MenuItemCard({ item, onClick, strong, muted, inset }: { item: { id: string; title: string; imageUrl?: string; href: string }; onClick: () => void; strong: string; muted: string; inset: string }) {
  return (
    <Link href={item.href} onClick={onClick} className="group block rounded-xl p-1.5 transition-colors hover:bg-[var(--menu-hover)]" style={{ ['--menu-hover' as string]: inset }}>
      <span className="grid aspect-video w-full place-items-center overflow-hidden rounded-lg" style={{ background: inset }}>
        {item.imageUrl
          ? <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
          : <GraduationCap className="h-5 w-5" style={{ color: muted }} />}
      </span>
      <span className="mt-2 block px-0.5 text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: strong }}>{item.title}</span>
    </Link>
  );
}

/** "See all courses", as the rounded button the home page sections use. */
function SeeAllButton({ group, hrefFor, onNavigate, strong, line }: { group: MenuGroup; hrefFor?: (anchor: string) => string; onNavigate: () => void; strong: string; line: string }) {
  return (
    <NavSectionLink anchor={group.anchor} hrefFor={hrefFor} onNavigate={onNavigate}
      className="group inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-bold"
      style={{ color: strong, boxShadow: `inset 0 0 0 1px ${line}` }}>
      See all {group.label.toLowerCase()}
      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
    </NavSectionLink>
  );
}

function NavLearnMenu({ label, groups, hrefFor, isPageDark, fontFamily }: {
  label: string;
  groups: Array<{ label: string; anchor: string; subGroups?: NavSubGroup[] }>;
  hrefFor?: (anchor: string) => string;
  isPageDark?: boolean; fontFamily?: string;
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

  const typeColRef = useRef<HTMLDivElement>(null);
  const subColRef  = useRef<HTMLDivElement>(null);
  // On one of the menu's own pages (/courses, /products...), the trigger shows you are there.
  const pathname = usePathname() ?? '';
  const here = groups.some(group => group.anchor.startsWith('/') && pathname.startsWith(group.anchor));

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
        aria-expanded={open} aria-haspopup="true" aria-current={here ? 'page' : undefined}
        className="group relative flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors"
        style={{ color: open || here ? strong : text, background: open || here ? inset : 'transparent', fontWeight: here ? 600 : undefined, fontFamily }}>
        {label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
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
              width: 'min(920px, calc(100vw - 220px))', background: panel, border: hair,
              // A generous floor, so the short first column leaves space under it rather than
              // squashing the panel -- but it yields on a short screen. min-height beats
              // max-height in CSS, so a fixed 420 here would have won and pushed the bottom of
              // the panel past the viewport, where overflow-hidden made it unreachable: the item
              // list is capped and scrolls instead. 72px clears the nav and the panel's own
              // margin, and leaves a little air beneath.
              minHeight: 'min(420px, calc(100vh - 88px))',
              maxHeight: 'calc(100vh - 88px)',
              boxShadow: isPageDark ? '0 24px 60px rgba(0,0,0,0.55)' : '0 24px 60px -24px rgba(16,24,40,0.28)',
              fontFamily,
            }}>

            {/* Left: each kind of content, with its icon tile and how many there are. A click
                selects; the arrow keys do it for a keyboard, and only the selected row is
                tabbable so Tab moves on into its items. */}
            <div ref={typeColRef}
              onKeyDown={e => handleRovingKeys(e, typeColRef, groups.length, active, selectType)}
              className="flex-shrink-0 space-y-1 overflow-y-auto p-3" style={{ width: 252, borderRight: hair }}>
              {groups.map((group, i) => (
                <div key={group.anchor} data-roving-row>
                  <button type="button" onClick={() => selectType(i)} aria-pressed={i === active}
                    tabIndex={i === active ? 0 : -1}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors"
                    style={{ background: i === active ? inset : 'transparent', color: i === active ? strong : muted }}>
                    <TypeTile anchor={group.anchor} />
                    <span className="min-w-0 flex-1 whitespace-nowrap text-sm font-semibold" style={{ color: strong }}>{group.label}</span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ opacity: i === active ? 1 : 0.35 }} />
                  </button>
                </div>
              ))}
            </div>

            {/* Right: the chosen kind: what it is, its groupings as chips, a few of its items as
                cards, and the way to all of them. */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
              <p className="text-[17px] font-bold" style={{ color: strong }}>{current?.label}</p>
              {current && TYPE_META[current.anchor] && <p className="mt-0.5 text-[13px]" style={{ color: muted }}>{TYPE_META[current.anchor].line}</p>}
              {showSubs && (
                <div ref={subColRef} className="mt-4 flex flex-wrap gap-1.5">
                  {subGroups.map((group, i) => (
                    <GroupChip key={group.label || i} label={group.label} on={i === activeSub} inset={inset} muted={muted}
                      onClick={() => setActiveSub(i)} />
                  ))}
                </div>
              )}
              {items.length === 0 ? (
                <p className="mt-5 text-sm" style={{ color: muted }}>Nothing published here yet.</p>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {items.slice(0, 6).map(item => (
                    <MenuItemCard key={item.id} item={item} onClick={() => setOpen(false)} strong={strong} muted={muted} inset={inset} />
                  ))}
                </div>
              )}
              {current && (
                <div className="mt-auto pt-5">
                  <SeeAllButton group={current} hrefFor={hrefFor} onNavigate={() => setOpen(false)} strong={strong} line={isPageDark ? 'rgba(255,255,255,0.25)' : '#D5DAE1'} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The same content on a phone, where hover does not exist and the desktop row is hidden.
 *
 * Three side-by-side columns do not fit 390px, so the structure becomes an accordion: tap a type
 * to open it, its groupings appear as chips, and the items sit under the selected chip. Pricing
 * lives in here too -- the bar only has room for the logo, this trigger and the account buttons.
 */
function NavMobileMenu({ groups, hrefFor, isPageDark, fontFamily, user, publicSignupEnabled }: {
  groups: Array<{ label: string; anchor: string; subGroups?: NavSubGroup[] }>;
  hrefFor?: (anchor: string) => string;
  isPageDark?: boolean; fontFamily?: string;
  user: any; publicSignupEnabled: boolean;
}) {
  const [open, setOpen]         = useState(false);
  const [openType, setOpenType] = useState<number | null>(null);
  const [activeSub, setActiveSub] = useState(0);
  const reduced = useReducedMotion();


  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const strong = isPageDark ? '#ffffff' : '#1C1D1F';
  const muted  = isPageDark ? 'rgba(255,255,255,0.60)' : '#6E7383';
  const panel  = isPageDark ? '#0d1117' : '#ffffff';
  const inset  = isPageDark ? 'rgba(255,255,255,0.06)' : '#F4F7F9';
  const hair   = isPageDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #E8EBEF';

  return (
    <>
      <button type="button" onClick={() => setOpen(v => !v)}
        aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'}
        className="lg:hidden grid place-items-center w-9 h-9 rounded-lg transition-colors"
        style={{ color: strong }}>
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: EASE_OUT }}
            className="lg:hidden absolute left-0 right-0 top-full overflow-y-auto"
            style={{
              background: panel, borderTop: hair, maxHeight: 'calc(100vh - 64px)', fontFamily,
              boxShadow: '0 24px 40px -20px rgba(0,0,0,0.35)',
            }}>
            {openType === null ? (
              // First screen: each kind as a row (icon tile, name, how many), then Pricing.
              <div className="px-4 py-3">
                {groups.map((group, i) => (
                  <button key={group.anchor} type="button" onClick={() => { setOpenType(i); setActiveSub(0); }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left">
                    <TypeTile anchor={group.anchor} size={22} />
                    <span className="min-w-0 flex-1 text-[15px] font-bold" style={{ color: strong }}>{group.label}</span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: muted }} />
                  </button>
                ))}
                <div className="mx-2 my-2" style={{ borderTop: hair }} />
                <Link href="/pricing" onClick={() => setOpen(false)}
                  className="block rounded-xl px-2 py-3 text-[15px] font-bold" style={{ color: strong }}>
                  Pricing
                </Link>
              </div>
            ) : (() => {
              // Second screen: one kind, its groupings as chips, its items, and See all.
              const group = groups[Math.min(openType, groups.length - 1)];
              const subGroups = group.subGroups ?? [];
              const showSubs  = subGroups.some(g => g.label);
              const items     = subGroups[Math.min(activeSub, Math.max(0, subGroups.length - 1))]?.items ?? [];
              return (
                <div className="px-5 pt-3 pb-5">
                  <button type="button" onClick={() => setOpenType(null)} className="-ml-1 flex items-center gap-1.5 py-1.5 text-sm font-semibold" style={{ color: muted }}>
                    <ArrowLeft className="h-4 w-4" /> All
                  </button>
                  <div className="mt-2 flex items-center gap-3">
                    <TypeTile anchor={group.anchor} size={26} />
                    <div className="min-w-0">
                      <p className="text-lg font-bold" style={{ color: strong }}>{group.label}</p>
                      {TYPE_META[group.anchor] && <p className="text-[13px]" style={{ color: muted }}>{TYPE_META[group.anchor].line}</p>}
                    </div>
                  </div>
                  {showSubs && (
                    <div className="-mx-5 mt-4 flex gap-1.5 overflow-x-auto px-5" style={{ scrollbarWidth: 'none' }}>
                      {subGroups.map((sub, si) => (
                        <GroupChip key={sub.label || si} label={sub.label} on={si === activeSub} inset={inset} muted={muted} onClick={() => setActiveSub(si)} />
                      ))}
                    </div>
                  )}
                  <div className="mt-3 space-y-1">
                    {items.map(item => (
                      <Link key={item.id} href={item.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-2">
                        <span className="grid flex-shrink-0 place-items-center overflow-hidden rounded-lg" style={{ width: 72, height: 40, background: inset }}>
                          {item.imageUrl
                            ? <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                            : <GraduationCap className="h-4 w-4" style={{ color: muted }} />}
                        </span>
                        <span className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: strong }}>{item.title}</span>
                      </Link>
                    ))}
                  </div>
                  <div className="mt-4">
                    <SeeAllButton group={group} hrefFor={hrefFor} onNavigate={() => setOpen(false)} strong={strong} line={isPageDark ? 'rgba(255,255,255,0.25)' : '#D5DAE1'} />
                  </div>
                </div>
              );
            })()}

            {/* Sticks to the bottom of the sheet as it scrolls, so the two actions a visitor
                without an account came for stay in reach however far down the list they are.
                Only when signed out -- a signed-in visitor keeps the profile menu in the bar,
                which is an avatar and costs no room. */}
            {!user && (
              <div className="sticky bottom-0 flex gap-2 px-5 py-4"
                style={{ background: panel, borderTop: hair }}>
                {/* The main action in the primary blue: Sign up while signups are open, else Log in. */}
                <Link href="/auth" onClick={() => setOpen(false)}
                  className="flex-1 text-center py-3 rounded-xl text-sm font-bold"
                  style={publicSignupEnabled
                    ? { border: `2px solid ${isPageDark ? 'rgba(255,255,255,0.20)' : '#E8EBEF'}`, color: strong }
                    : { background: '#3E93FF', color: '#ffffff' }}>
                  Log in
                </Link>
                {publicSignupEnabled && (
                  <Link href="/auth?mode=signup" onClick={() => setOpen(false)}
                    className="flex-1 text-center py-3 rounded-xl text-sm font-bold"
                    style={{ background: '#3E93FF', color: '#ffffff' }}>
                    Sign up
                  </Link>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function LandingNav({
  appName, logoUrl, logoDarkUrl, isPageDark, scrolled, user, profile,
  publicSignupEnabled, primaryColor, fontFamily, navLinks, navLinkHref, navMenuLabel,
}: LandingNavProps) {
  // When the sheet exists it carries Pricing and, signed out, the auth buttons -- so the bar drops
  // them below md rather than crowding the logo off the screen.
  const hasMobileSheet = Boolean(navMenuLabel && navLinks.length > 0);
  const NAVY  = '#003262';
  const BLUE  = primaryColor || '#0056D2';
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
        <div className={`max-w-[1240px] mx-auto ${GUTTER} h-16 flex items-center`}>
          <div className="flex items-center gap-2.5 mr-8 flex-shrink-0">
            {logoUrl || logoDarkUrl
              ? <img src={(isPageDark ? (logoDarkUrl || logoUrl) : (logoUrl || logoDarkUrl)) ?? undefined} alt={appName} className="h-10 w-auto" />
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
          <div className="hidden lg:flex items-center gap-1 flex-1">
            {navMenuLabel && navLinks.length > 0 ? (
              <NavLearnMenu label={navMenuLabel} groups={navLinks} hrefFor={navLinkHref}
                isPageDark={isPageDark} fontFamily={fontFamily} />
            ) : navLinks.map(nl => (
              <NavSectionLink key={nl.anchor} anchor={nl.anchor} hrefFor={navLinkHref}
                className={`relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${isPageDark ? 'hover:bg-white/10' : 'hover:bg-[#F4F7F9]'}`}
                style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
                {nl.label}
              </NavSectionLink>
            ))}
            {/* Sits with the section navigation rather than beside the account controls, and is
                styled as a nav link so it matches what it now stands next to. */}
            <Link href="/pricing"
              className={`relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${isPageDark ? 'hover:bg-white/10' : 'hover:bg-[#F4F7F9]'}`}
              style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
              Pricing
            </Link>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            {hasMobileSheet ? (
              /* Carries Pricing and the signed-out auth buttons itself, because the bar has room
                 for the logo, this trigger and nothing else once Sign up is enabled. */
              <NavMobileMenu groups={navLinks} hrefFor={navLinkHref}
                isPageDark={isPageDark} fontFamily={fontFamily}
                user={user} publicSignupEnabled={publicSignupEnabled} />
            ) : (
              /* No mobile sheet on pages that pass flat links, so Pricing stays in the bar there
                 rather than becoming unreachable on a phone. */
              <Link href="/pricing"
                className="lg:hidden px-3 sm:px-4 py-2 text-sm font-semibold rounded-md transition-colors"
                style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}>
                Pricing
              </Link>
            )}
            {user ? <ProfileMenu user={user} profile={profile} dark={isPageDark} fontFamily={fontFamily}
              onSignOut={async () => { await supabase.auth.signOut({ scope: 'local' }); window.location.href = '/'; }} /> : (
              <>
                <Link href="/auth"
                  className={`${hasMobileSheet ? 'hidden lg:inline-block' : ''} px-3 sm:px-4 py-2 text-sm font-semibold rounded-md transition-colors`}
                  style={{ color: isPageDark ? 'rgba(255,255,255,0.80)' : '#1C1D1F' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isPageDark ? 'rgba(255,255,255,0.08)' : '#F7F9FC'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  Log in
                </Link>
                {publicSignupEnabled && (
                  <Link href="/auth?mode=signup"
                    className={`${hasMobileSheet ? 'hidden lg:inline-block' : ''} px-3 sm:px-4 py-2 text-sm font-bold rounded-md transition-opacity hover:opacity-90`}
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
  footerLink3Label, footerLink3Url, footerLink4Label, footerLink4Url, programmes,
}: LandingFooterProps) {
  const { publicSignupEnabled } = useTenant();
  // A link to a catalogue page (/courses) or a home page section (/#section-courses, as older saved
  // settings have it) goes when there is nothing of that kind to show. Any other link always shows.
  const SECTION_TYPE: Record<string, ProgrammeItem['type']> = {
    'section-courses': 'course', 'section-paths': 'path', 'section-ves': 've', 'section-certifications': 'certification',
    '/courses': 'course', '/learning-paths': 'path', '/virtual-experiences': 've', '/certifications': 'certification',
  };
  const leadsSomewhere = (href: string) => {
    const type = SECTION_TYPE[href.includes('#') ? href.split('#')[1] : href];
    return !type || programmes.some(p => p.type === type);
  };
  const learnLinks = [
    [footerLink1Label || 'Courses',             footerLink1Url || '/courses'],
    [footerLink2Label || 'Learning paths',      footerLink2Url || '/learning-paths'],
    [footerLink3Label || 'Virtual experiences', footerLink3Url || '/virtual-experiences'],
    [footerLink4Label || 'Certifications',      footerLink4Url || '/certifications'],
  ].filter(([label, href]) => label && leadsSomewhere(href));
  // Sign up only while signups are open, as in the nav; Dashboard only for someone signed in.
  const accountLinks = [
    ['Log in', '/auth'],
    ...(publicSignupEnabled ? [['Sign up', '/auth?mode=signup']] : []),
    ...(user ? [['Dashboard', '/student']] : []),
  ];
  // At least 4.5:1 against the primary colour, which is what the footer sits on.
  const linkColor = 'rgba(255,255,255,0.82)';
  const link = ([label, href]: string[]) => (
    <Link key={label} href={href} className="text-sm inline-block transition-all duration-200 hover:translate-x-1"
      style={{ color: linkColor }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'white'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = linkColor; }}>
      {label}
    </Link>
  );
  return (
      <footer style={{ background: isPageDark ? '#0D1117' : (primaryColor || '#0056D2'), fontFamily }}>
        <div className={`max-w-[1240px] mx-auto ${GUTTER} pt-12 pb-8`}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="mb-2" style={{ ...M3.titleMedium, fontWeight: 800, color: 'white' }}>{appName}</div>
              <p className="max-w-[240px]" style={{ ...M3.bodyMedium, color: 'rgba(255,255,255,0.78)' }}>{footerTagline}</p>
            </div>
            <div>
              <div className="mb-4" style={{ ...M3.titleSmall, fontWeight: 700, color: 'white' }}>
                {footerLinksHeading || 'Learn'}
              </div>
              <div className="flex flex-col gap-2 items-start">
                {learnLinks.map(link)}
              </div>
            </div>
            <div>
              <div className="mb-4" style={{ ...M3.titleSmall, fontWeight: 700, color: 'white' }}>Account</div>
              <div className="flex flex-col gap-2 items-start">
                {accountLinks.map(link)}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-6 flex-wrap gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.78)' }}>
              &copy; {new Date().getFullYear()} {appName}. All rights reserved.
            </p>
            <div className="flex items-center gap-5 flex-wrap">
              {([
                ['Privacy policy', '/privacy'],
                ['Terms of use',   '/terms'],
              ] as const).map(([label, href]) => (
                <Link key={label} href={href} className="text-xs transition-colors"
                  style={{ color: linkColor }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'white'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = linkColor; }}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
  );
}
