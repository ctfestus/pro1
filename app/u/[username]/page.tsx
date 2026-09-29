'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, CalendarDays, MapPin, Star, CheckCircle2,
  BookOpen, Copy, Check, Sun, Moon, Zap, ArrowRight, Building2, Globe,
} from 'lucide-react';
import Link from 'next/link';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { courseXpOnOffer } from '@/lib/course-progress';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';

/* --- Theme tokens --- */
const LIGHT = {
  page:        '#F9F9F9',
  blob:        '#ADEE66',
  nav:         'rgba(249,249,249,0.92)',
  navBorder:   'rgba(0,0,0,0.06)',
  navText:     '#555',
  logoText:    '#111',
  card:        '#FFFFFF',
  cardShadow:  'none',
  coverBg:     'linear-gradient(135deg,#d4edda,#b8dfc4)',
  avatarBg:    '#d4edda',
  avatarText:  '#00bf63',
  avatarBorder:'#FFFFFF',
  name:        '#111',
  handle:      '#00bf63',
  bio:         '#555',
  pill:        '#F3F3F3',
  pillBorder:  'transparent',
  statsBg:     '#F3F3F3',
  statsText:   '#333',
  statsMuted:  '#888',
  sectionLabel:'#888',
  statusBg:    '#e8f5ee',
  statusText:  '#00bf63',
  ctaBg:       '#F3F3F3',
  ctaText:     '#111',
  socialBg:    '#F3F3F3',
  toggleBg:    '#EBEBEB',
  toggleIcon:  '#555',
  emptyCard:   '#FFFFFF',
  footerText:  '#999',
  footerBold:  '#111',
};

const DARK = {
  page:        '#111111',
  blob:        '#1a3a1a',
  nav:         'rgba(17,17,17,0.9)',
  navBorder:   'rgba(255,255,255,0.07)',
  navText:     '#aaa',
  logoText:    '#f0f0f0',
  card:        '#1E1F26',
  cardShadow:  '0 2px 20px rgba(0,0,0,0.4)',
  coverBg:     'linear-gradient(135deg,#1a3a24,#0f2818)',
  avatarBg:    '#1a3a24',
  avatarText:  '#ADEE66',
  avatarBorder:'#1E1F26',
  name:        '#f0f0f0',
  handle:      '#ADEE66',
  bio:         '#aaa',
  pill:        '#2a2a2a',
  pillBorder:  'transparent',
  statsBg:     '#242424',
  statsText:   '#e0e0e0',
  statsMuted:  '#777',
  sectionLabel:'#666',
  statusBg:    'rgba(173,238,102,0.12)',
  statusText:  '#ADEE66',
  ctaBg:       '#242424',
  ctaText:     '#e0e0e0',
  socialBg:    '#242424',
  toggleBg:    '#2a2a2a',
  toggleIcon:  '#ADEE66',
  emptyCard:   '#1E1F26',
  footerText:  '#555',
  footerBold:  '#aaa',
};

/* --- Brand SVG social icons --- */
const SocialSVGs: Record<string, { svg: (dark: boolean) => React.ReactNode; label: string }> = {
  twitter: {
    label: 'X / Twitter',
    svg: (dark) => (
      <svg viewBox="0 0 24 24" fill={dark ? '#e0e0e0' : '#111'} width="16" height="16">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.264 5.638L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
      </svg>
    ),
  },
  linkedin: {
    label: 'LinkedIn',
    svg: () => (
      <svg viewBox="0 0 24 24" fill="#0A66C2" width="16" height="16">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
  instagram: {
    label: 'Instagram',
    svg: () => (
      <svg viewBox="0 0 24 24" width="16" height="16">
        <defs>
          <radialGradient id="ig-g" cx="30%" cy="107%" r="150%">
            <stop offset="0%" stopColor="#fdf497"/>
            <stop offset="5%" stopColor="#fdf497"/>
            <stop offset="45%" stopColor="#fd5949"/>
            <stop offset="60%" stopColor="#d6249f"/>
            <stop offset="90%" stopColor="#285AEB"/>
          </radialGradient>
        </defs>
        <path fill="url(#ig-g)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
      </svg>
    ),
  },
  youtube: {
    label: 'YouTube',
    svg: () => (
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  github: {
    label: 'GitHub',
    svg: (dark) => (
      <svg viewBox="0 0 24 24" fill={dark ? '#e0e0e0' : '#111'} width="16" height="16">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
      </svg>
    ),
  },
  website: {
    label: 'Website',
    svg: (dark) => (
      <svg viewBox="0 0 24 24" fill="none" stroke={dark ? '#aaa' : '#555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
      </svg>
    ),
  },
};

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* --- Page --- */
export default function PublicProfile({ params }: { params: Promise<{ username: string }> }) {
  const { theme, toggle: toggleDark } = useTheme();
  const { logoUrl } = useTenant();
  const dark = theme === 'dark';
  const t = dark ? DARK : LIGHT;
  const [profile, setProfile] = useState<any>(null);
  const [forms, setForms]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    const load = async () => {
      const { username } = await params;
      const { data: prof } = await supabase
        .from('public_profiles')
        .select('id, username, name, bio, avatar_url, cover_url, cover_position, social_links, account_type, industry, location')
        .eq('username', username)
        .single();
      if (!prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof);
      // The courses table is closed to signed-out visitors (migration 215), so they read the
      // free-courses view instead -- the same list RLS used to give them.
      const { data: { session } } = await supabase.auth.getSession();
      const [{ data: courseRows }, { data: eventRows }] = await Promise.all([
        session
          ? supabase.from('courses').select('id, slug, title, description, cover_image, created_at').eq('user_id', prof.id).eq('status', 'published').order('created_at', { ascending: false })
          : supabase.from('public_free_courses').select('id, slug, title, description, cover_image, created_at').eq('user_id', prof.id).order('created_at', { ascending: false }),
        supabase.from('events').select('id, slug, title, description, cover_image, event_date, is_private, created_at').eq('user_id', prof.id).eq('status', 'published').order('created_at', { ascending: false }),
      ]);
      const allForms = [
        ...(courseRows ?? []).map((c: any) => ({ ...c, content_type: 'course', config: { isCourse: true, title: c.title, coverImage: c.cover_image } })),
        ...(eventRows ?? []).map((e: any) => ({ ...e, content_type: 'event', config: { title: e.title, coverImage: e.cover_image, eventDetails: { isEvent: true, isPrivate: e.is_private, date: e.event_date } } })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setForms(allForms);
      setLoading(false);
    };
    load();
  }, [params]);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: t.page }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00bf63' }} />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: t.page }}>
      <p className="text-5xl">🤷</p>
      <h1 className="text-xl font-bold" style={{ color: t.name }}>Profile not found</h1>
      <p className="text-sm" style={{ color: t.bio }}>This username doesn&apos;t exist.</p>
      <Link href="/" className="text-sm underline" style={{ color: '#00bf63' }}>Go home</Link>
    </div>
  );

  const initials = (profile.name || profile.username || '?').slice(0, 2).toUpperCase();
  const socialEntries = Object.entries((profile.social_links ?? {}) as Record<string, string>).filter(([, v]) => !!v);
  const now = new Date();
  const courses = forms.filter((f: any) => f.config?.isCourse);
  const eventForms = forms.filter((f: any) => f.config?.eventDetails?.isEvent && !f.config?.eventDetails?.isPrivate);
  const sortByDate = (a: any, b: any) => new Date(b.config?.eventDetails?.date ?? 0).getTime() - new Date(a.config?.eventDetails?.date ?? 0).getTime();
  const upcomingEvents = eventForms.filter(f => { const d = f.config?.eventDetails?.date; return d && new Date(d) >= now; }).sort(sortByDate);
  const pastEvents = eventForms.filter(f => { const d = f.config?.eventDetails?.date; return !d || new Date(d) < now; }).sort(sortByDate);

  return (
    <div className="min-h-screen relative" style={{ background: t.page, transition: 'background 0.3s' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); *{font-family:'Inter',sans-serif;}`}</style>

      {/* Navbar */}
      <nav className="sticky top-0 z-30 px-6 md:px-10 h-14 flex items-center justify-between backdrop-blur-md border-b"
        style={{ background: t.nav, borderColor: t.navBorder, transition: 'background 0.3s, border-color 0.3s' }}>
        <Link href="/" className="flex items-center gap-2.5">
          <img src={logoUrl || undefined} alt="" className="h-8 w-auto" />
        </Link>

        <div className="flex items-center gap-3">
          <button onClick={handleCopy} className="flex items-center gap-1.5 text-sm font-medium" style={{ color: t.navText }}>
            {copied ? <Check className="w-4 h-4" style={{ color: '#00bf63' }}/> : <Copy className="w-4 h-4"/>}
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Share Profile'}</span>
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={toggleDark}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{ background: t.toggleBg }}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={dark ? 'sun' : 'moon'}
                initial={{ rotate: -30, opacity: 0, scale: 0.7 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 30, opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex' }}
              >
                {dark
                  ? <Sun className="w-4 h-4" style={{ color: t.toggleIcon }}/>
                  : <Moon className="w-4 h-4" style={{ color: t.toggleIcon }}/>
                }
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 pb-20 pt-4 space-y-6">

        {/* -- Profile hero card --- */}
        {(() => {
          const isCompany = profile.account_type === 'company';
          const rawWebsite = (profile.social_links as Record<string, string>)?.website ?? '';
          const websiteUrl = /^https?:\/\//i.test(rawWebsite) ? rawWebsite : rawWebsite ? `https://${rawWebsite}` : '';

          const coverPos = profile.cover_position ? profile.cover_position.replace(' ', '% ') + '%' : '50% 50%';
          const statsBg = t.statsBg;
          const statPills = (courses.length > 0 || eventForms.length > 0) ? (
            <div className="flex items-center gap-3 flex-wrap">
              {courses.length > 0 && (
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm" style={{ background: statsBg, transition: 'background 0.3s' }}>
                  <BookOpen className="w-4 h-4" style={{ color: '#00bf63' }}/>
                  <span className="font-semibold" style={{ color: t.statsText }}>{courses.length}</span>
                  <span className="text-xs" style={{ color: t.statsMuted }}>{courses.length === 1 ? 'Course' : 'Courses'}</span>
                </div>
              )}
              {eventForms.length > 0 && (
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm" style={{ background: statsBg, transition: 'background 0.3s' }}>
                  <CalendarDays className="w-4 h-4" style={{ color: '#00bf63' }}/>
                  <span className="font-semibold" style={{ color: t.statsText }}>{eventForms.length}</span>
                  <span className="text-xs" style={{ color: t.statsMuted }}>{eventForms.length === 1 ? 'Event' : 'Events'}</span>
                </div>
              )}
            </div>
          ) : null;

          return (
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22,1,0.36,1] }}
              className="rounded-3xl overflow-hidden"
              style={{ background: t.card, transition: 'background 0.3s' }}
            >
              {/* Cover -- inset */}
              <div className="p-3 pb-0">
                <div className="relative overflow-hidden rounded-2xl group" style={{ height: 'clamp(160px, 40vw, 240px)', background: t.coverBg, transition: 'background 0.3s' }}>
                  {profile.cover_url && (
                    <img src={profile.cover_url} alt="Cover"
                      className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      style={{ objectPosition: coverPos }}/>
                  )}
                </div>
              </div>

              {isCompany ? (
                /* -- Company Layout --- */
                <div className="relative px-5 sm:px-7 pb-7">
                  {/* Logo -- overlaps cover bottom */}
                  <div className="relative z-10 -mt-10 mb-3">
                    <div className="w-[90px] h-[90px] rounded-2xl overflow-hidden flex items-center justify-center text-2xl font-bold"
                      style={{ border: `3px solid ${t.avatarBorder}`, background: t.avatarBg, color: t.avatarText }}>
                      {profile.avatar_url
                        ? <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover"/>
                        : <Building2 style={{ width: 32, height: 32, color: t.avatarText }}/>}
                    </div>
                  </div>
                  {/* Name + handle -- always below the logo */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      {profile.name && <h1 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: t.name }}>{profile.name}</h1>}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: dark ? 'rgba(173,238,102,0.12)' : 'rgba(0,191,99,0.08)', color: dark ? '#ADEE66' : '#00bf63' }}>
                        <CheckCircle2 style={{ width: 11, height: 11 }}/> Verified
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-sm font-medium" style={{ color: t.handle }}>@{profile.username}</p>
                      {profile.industry && (
                        <>
                          <span style={{ color: t.statsMuted }}>·</span>
                          <span className="text-sm" style={{ color: t.statsMuted }}>{profile.industry}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Bio */}
                  {profile.bio && (
                    <p className="text-sm leading-relaxed mb-4" style={{ color: t.bio }}>{profile.bio}</p>
                  )}

                  {/* Website + Location row */}
                  {(websiteUrl || profile.location) && (
                    <div className="flex items-center gap-4 flex-wrap mb-4">
                      {websiteUrl && (
                        <a href={websiteUrl} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                          style={{ color: dark ? '#ADEE66' : '#00bf63' }}>
                          <Globe style={{ width: 14, height: 14 }}/> {websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      )}
                      {profile.location && (
                        <span className="flex items-center gap-1.5 text-sm" style={{ color: t.statsMuted }}>
                          <MapPin style={{ width: 14, height: 14 }}/> {profile.location}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Social icons */}
                  {socialEntries.filter(([k]) => k !== 'website').length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap mb-5">
                      {socialEntries.filter(([k]) => k !== 'website').slice(0, 5).map(([key, url]) => {
                        const s = SocialSVGs[key];
                        if (!s) return null;
                        return (
                          <a key={key} href={url as string} target="_blank" rel="noreferrer" title={s.label}
                            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                            style={{ background: t.socialBg }}>
                            {s.svg(dark)}
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {statPills}
                </div>
              ) : (
                /* -- Creator Layout --- */
                <div className="relative px-4 sm:px-6 pb-6">
                  {/* Avatar + name row */}
                  <div className="flex items-end gap-4 -mt-12 mb-4">
                    <div className="relative flex-shrink-0">
                      <div className="w-[108px] h-[108px] rounded-full overflow-hidden flex items-center justify-center text-3xl font-bold"
                        style={{ border: `4px solid ${t.avatarBorder}`, background: t.avatarBg, color: t.avatarText }}>
                        {profile.avatar_url
                          ? <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover"/>
                          : <span>{initials}</span>}
                      </div>
                      <div className="absolute bottom-1 right-1 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: '#ADEE66' }}>
                        <CheckCircle2 style={{ width: 18, height: 18, color: '#00bf63' }}/>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      {profile.name && <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: t.name }}>{profile.name}</h1>}
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <p className="text-sm font-medium" style={{ color: t.handle }}>@{profile.username}</p>
                        {profile.industry && (
                          <>
                            <span style={{ color: t.statsMuted }}>·</span>
                            <span className="text-sm" style={{ color: t.statsMuted }}>{profile.industry}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Social icons */}
                  {socialEntries.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap mb-4">
                      {socialEntries.slice(0, 6).map(([key, url]) => {
                        const s = SocialSVGs[key];
                        if (!s) return null;
                        return (
                          <a key={key} href={url as string} target="_blank" rel="noreferrer" title={s.label}
                            className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110"
                            style={{ background: t.socialBg }}>
                            {s.svg(dark)}
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {/* Location */}
                  {profile.location && (
                    <div className="flex items-center gap-1.5 mb-3">
                      <MapPin style={{ width: 13, height: 13, color: t.statsMuted }}/>
                      <span className="text-sm" style={{ color: t.statsMuted }}>{profile.location}</span>
                    </div>
                  )}

                  {profile.bio && (
                    <p className="text-sm leading-relaxed max-w-2xl mb-4" style={{ color: t.bio }}>{profile.bio}</p>
                  )}

                  {statPills}
                </div>
              )}
            </motion.div>
          );
        })()}

        {/* -- Courses --- */}
        {courses.length > 0 && (
          <motion.section initial={{ opacity:0,y:14 }} animate={{ opacity:1,y:0 }} transition={{ delay:0.12,duration:0.45,ease:[0.22,1,0.36,1] }} className="space-y-4">
            <SectionHeader label="Courses" count={courses.length} t={t}/>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map((f, i) => {
                const desc = (f.description ?? '').replace(/<[^>]*>/g, '');
                return <CourseCard key={f.id} index={i} href={`/${f.slug||f.id}`} cover={f.config?.coverImage} title={f.title} description={desc} status="Enrollment Open" cta="Enroll Now" config={f.config} creatorName={profile.name || profile.username} creatorAvatar={profile.avatar_url} t={t}/>;
              })}
            </div>
          </motion.section>
        )}

        {/* -- Upcoming Events --- */}
        {upcomingEvents.length > 0 && (
          <motion.section initial={{ opacity:0,y:14 }} animate={{ opacity:1,y:0 }} transition={{ delay:0.18,duration:0.45,ease:[0.22,1,0.36,1] }} className="space-y-4">
            <SectionHeader label="Upcoming Events" count={upcomingEvents.length} t={t}/>
            <div>
              {upcomingEvents.map((f, i) => {
                const ev = f.config?.eventDetails ?? {};
                const desc = (f.description ?? '').replace(/<[^>]*>/g, '');
                const statusLabel = ev.date ? `${formatDate(ev.date)}${ev.time?' · '+ev.time:''}` : 'Upcoming';
                return <EventCard key={f.id} index={i} isLast={i === upcomingEvents.length - 1} href={`/${f.slug||f.id}`} cover={f.config?.coverImage} title={f.title} description={desc} status={statusLabel} location={ev.location} config={f.config} creatorName={profile.name || profile.username} creatorAvatar={profile.avatar_url} t={t}/>;
              })}
            </div>
          </motion.section>
        )}

        {/* -- Past Events --- */}
        {pastEvents.length > 0 && (
          <motion.section initial={{ opacity:0,y:14 }} animate={{ opacity:1,y:0 }} transition={{ delay:0.22,duration:0.45,ease:[0.22,1,0.36,1] }} className="space-y-4">
            <SectionHeader label="Past Events" t={t}/>
            <div className="opacity-60">
              {pastEvents.map((f, i) => {
                const ev = f.config?.eventDetails ?? {};
                const desc = (f.description ?? '').replace(/<[^>]*>/g, '');
                return <EventCard key={f.id} index={i} isLast={i === pastEvents.length - 1} href={`/${f.slug||f.id}`} cover={f.config?.coverImage} title={f.title} description={desc} status={ev.date?formatDate(ev.date):'Past'} location={ev.location} config={f.config} creatorName={profile.name || profile.username} creatorAvatar={profile.avatar_url} t={t}/>;
              })}
            </div>
          </motion.section>
        )}

        {forms.length === 0 && (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: t.emptyCard }}>
              <Star className="w-7 h-7" style={{ color: '#ADEE66' }}/>
            </div>
            <p className="font-medium" style={{ color: t.statsMuted }}>No offerings yet</p>
          </div>
        )}
      </main>

    </div>
  );
}

/* --- Sub-components --- */
function SectionHeader({ label, count, t }: { label: string; count?: number; t: typeof LIGHT }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: t.sectionLabel, transition: 'color 0.3s' }}>{label}</h2>
      {count !== undefined && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#ADEE66', color: '#00bf63' }}>{count}</span>
      )}
    </div>
  );
}

function CourseCard({ index, href, cover, title, cta, config, creatorName, creatorAvatar, t }: {
  index: number; href: string; cover?: string; title: string;
  description?: string; status: string; cta: string; config?: any; creatorName?: string; creatorAvatar?: string; t: typeof LIGHT;
}) {
  const dark = t === DARK;
  const accent = '#ADEE66';
  const accentDark = '#00bf63';
  const initials = (creatorName || '?').slice(0, 2).toUpperCase();

  const questions: any[] = config?.questions || [];
  const assessmentCount = questions.length;
  // Shared rule: multiplying every slide by basePoints charged for lessons and downloads that award
  // nothing, and priced a LinkedIn share at basePoints instead of its own configured bonus (including
  // a deliberate 0).
  const totalPoints = courseXpOnOffer(questions, config?.pointsSystem);
  const chips = [
    ...(assessmentCount > 0 ? [{ icon: <BookOpen size={11}/>, label: `${assessmentCount} ${assessmentCount === 1 ? 'lesson' : 'lessons'}` }] : []),
    ...(totalPoints > 0    ? [{ icon: <Zap size={11}/>,      label: `${totalPoints} pts`  }] : []),
  ];

  return (
    <motion.a href={href} initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }}
      transition={{ delay:0.08+index*0.05,duration:0.4,ease:[0.22,1,0.36,1] }}
      className="group flex flex-col rounded-2xl overflow-hidden"
      style={{ background: t.card, textDecoration:'none', transition:'transform 0.3s,background 0.3s' }}
      onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-3px)'; }}
      onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; }}
    >
      {/* Cover -- padded rounded square */}
      <div style={{ padding: 12, background: t.card, flexShrink: 0 }}>
        <div className="relative transition-transform duration-700 group-hover:scale-[1.03]"
          style={{ borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', background: dark ? '#0f1f14' : '#1a2a1e' }}>
          {cover
            ? <img src={resolveCoverUrl(cover)} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => (e.currentTarget.style.display = 'none')}/>
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 16, background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <BookOpen style={{ width: 24, height: 24, color: accent }}/>
                </div>
              </div>
          }
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 16px 0 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: t.name, margin: 0, transition: 'color 0.3s' }}>{title}</h3>
        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.map((ch, i) => (
              <div key={i} style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 20, background: dark ? 'rgba(173,238,102,0.08)' : 'rgba(0,191,99,0.06)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: dark ? '#ffffff' : '#111111' }}>{ch.label}</span>
              </div>
            ))}
          </div>
        )}
        {creatorName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: t.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: t.avatarText }}>
              {creatorAvatar
                ? <img src={creatorAvatar} alt={creatorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                : initials}
            </div>
            <span style={{ fontSize: 12, color: t.statsMuted }}>by <span style={{ fontWeight: 600, color: t.bio }}>{creatorName}</span></span>
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: '12px 16px 16px 16px' }}>
        <div className="flex items-center justify-between group/cta"
          style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', borderRadius: 10, padding: '10px 14px', transition: 'background 0.2s, color 0.2s', cursor: 'pointer' }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = dark ? `${accent}18` : `${accentDark}10`;
            (el.querySelector('.cta-label') as HTMLElement).style.color = dark ? accent : accentDark;
            (el.querySelector('.cta-icon') as HTMLElement).style.color = dark ? accent : accentDark;
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
            (el.querySelector('.cta-label') as HTMLElement).style.color = dark ? '#aaa' : '#555';
            (el.querySelector('.cta-icon') as HTMLElement).style.color = dark ? '#aaa' : '#555';
          }}
          onTouchStart={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = dark ? `${accent}18` : `${accentDark}10`;
            (el.querySelector('.cta-label') as HTMLElement).style.color = dark ? accent : accentDark;
            (el.querySelector('.cta-icon') as HTMLElement).style.color = dark ? accent : accentDark;
          }}
          onTouchEnd={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
            (el.querySelector('.cta-label') as HTMLElement).style.color = dark ? '#aaa' : '#555';
            (el.querySelector('.cta-icon') as HTMLElement).style.color = dark ? '#aaa' : '#555';
          }}>
          <span className="cta-label" style={{ fontSize: 13, fontWeight: 700, color: dark ? '#aaa' : '#555', transition: 'color 0.2s' }}>{cta}</span>
          <div style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowRight size={13} className="cta-icon" style={{ color: dark ? '#aaa' : '#555', transition: 'color 0.2s' }}/>
          </div>
        </div>
      </div>
    </motion.a>
  );
}

function EventCard({ index, isLast, href, cover, title, description, status, location, config, creatorName, creatorAvatar, t }: {
  index: number; isLast: boolean; href: string; cover?: string; title: string;
  description?: string; status: string; location?: string; config?: any; creatorName?: string; creatorAvatar?: string; t: typeof LIGHT;
}) {
  const dark = t === DARK;
  const accent = '#ADEE66';
  const accentDark = '#00bf63';
  const dotColor = dark ? accent : accentDark;
  const lineColor = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
  const ev = config?.eventDetails ?? {};
  const eventType = ev.eventType as string | undefined;
  const meetingLink: string = ev.meetingLink || '';
  const platform = meetingLink.includes('meet.google') ? 'meet'
    : meetingLink.includes('zoom.us') ? 'zoom'
    : meetingLink.includes('teams.microsoft') || meetingLink.includes('teams.live') ? 'teams'
    : meetingLink ? 'link' : null;
  const platformMeta: Record<string, { label: string; icon: React.ReactNode }> = {
    meet:  { label: 'Google Meet',     icon: <img src="https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Meet.png" alt="Meet" style={{ width: 14, height: 14, objectFit: 'contain' }}/> },
    zoom:  { label: 'Zoom',            icon: <img src="https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Zoom.png" alt="Zoom" style={{ width: 14, height: 14, objectFit: 'contain' }}/> },
    teams: { label: 'Microsoft Teams', icon: <img src="https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Teams.png" alt="Teams" style={{ width: 14, height: 14, objectFit: 'contain' }}/> },
    link:  { label: 'Online',          icon: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg> },
  };
  const initials = (creatorName || '?').slice(0, 2).toUpperCase();

  return (
    <div className="relative flex gap-4">
      {/* Timeline spine */}
      <div className="flex flex-col items-center flex-shrink-0 w-5 pt-6">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 z-10"
          style={{ background: dotColor, boxShadow: `0 0 0 3px ${dark ? '#111' : '#F9F9F9'}, 0 0 0 5px ${dotColor}` }}/>
        {!isLast && <div className="flex-1 mt-2 w-px border-l-2 border-dashed" style={{ borderColor: lineColor }}/>}
      </div>

      {/* Card */}
      <motion.a href={href} initial={{ opacity:0,x:-16 }} animate={{ opacity:1,x:0 }}
        transition={{ delay:0.08+index*0.06,duration:0.4,ease:[0.22,1,0.36,1] }}
        className="group flex-1 mb-5 rounded-2xl overflow-hidden flex flex-col sm:flex-row"
        style={{ background: t.card, textDecoration:'none', transition:'transform 0.3s,background 0.3s' }}
        onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-3px)'; }}
        onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; }}
      >
        {/* Cover -- full-width banner on mobile, padded square on sm+ */}
        <div className="flex-shrink-0 sm:flex sm:items-center sm:justify-center"
          style={{ background: t.card }}>
          {/* Mobile: full-width 16:9 banner */}
          <div className="block sm:hidden overflow-hidden w-full transition-transform duration-700 group-hover:scale-[1.02]"
            style={{ aspectRatio: '16/9', background: dark ? '#0f1a14' : '#1a2a1e' }}>
            {cover
              ? <img src={resolveCoverUrl(cover)} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => (e.currentTarget.style.display = 'none')}/>
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CalendarDays style={{ width: 28, height: 28, color: accent }}/>
                </div>}
          </div>
          {/* Desktop: padded rounded square */}
          <div className="hidden sm:block overflow-hidden flex-shrink-0 transition-transform duration-700 group-hover:scale-[1.03]"
            style={{ width: 148, height: 148, borderRadius: 18, background: dark ? '#0f1a14' : '#1a2a1e', overflow: 'hidden', margin: 12 }}>
            {cover
              ? <img src={resolveCoverUrl(cover)} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => (e.currentTarget.style.display = 'none')}/>
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CalendarDays style={{ width: 24, height: 24, color: accent }}/>
                  </div>
                </div>
            }
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 18px 18px 18px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1, minWidth: 0 }}>

          {/* 1. Date + event type pills on same row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {status && (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 7, background: dark ? 'rgba(173,238,102,0.12)' : 'rgba(0,191,99,0.08)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: dark ? accent : accentDark }}>{status}</span>
              </span>
            )}
            {eventType && (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, backgroundImage: dark ? 'linear-gradient(90deg,#ADEE66,#6ee7b7)' : 'linear-gradient(90deg,#00bf63,#0ea472)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  {eventType === 'virtual' ? 'Virtual' : 'In-Person'}
                </span>
              </span>
            )}
          </div>

          {/* 1b. Virtual platform + registration notice */}
          {eventType === 'virtual' && platform && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: 20, borderRadius: 5, background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {platformMeta[platform].icon}
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: t.name }}>{platformMeta[platform].label}</span>
                <span style={{ fontSize: 11, color: t.statsMuted }}> · Link shared after registration</span>
              </div>
            </div>
          )}

          {/* 2. Location -- plain with icon, no pill */}
          {location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={12} style={{ color: t.statsMuted, flexShrink: 0 }}/>
              <span style={{ fontSize: 12, color: t.statsMuted }}>{location}</span>
            </div>
          )}

          {/* 3. Event name */}
          <h3 style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: t.name, margin: 0, transition: 'color 0.3s' }}>{title}</h3>

          {/* 3b. Description -- desktop only, max 3 lines */}
          {description && (
            <p className="hidden sm:block" style={{ fontSize: 13, color: t.bio, lineHeight: 1.6, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{description}</p>
          )}

          {/* 4. Creator row */}
          {creatorName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: t.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: t.avatarText }}>
                {creatorAvatar
                  ? <img src={creatorAvatar} alt={creatorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                  : initials}
              </div>
              <span style={{ fontSize: 12, color: t.statsMuted }}>by <span style={{ fontWeight: 600, color: t.bio }}>{creatorName}</span></span>
            </div>
          )}

        </div>
      </motion.a>
    </div>
  );
}
