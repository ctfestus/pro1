'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import {
  motion, AnimatePresence,
  useScroll, useTransform, useMotionValue, useSpring, useInView,
} from 'motion/react';
import {
  Loader2, MapPin, Award,
  Twitter, Linkedin, Instagram, Github, Youtube, Globe,
  Check, ExternalLink, GraduationCap, Sun, Moon,
  Briefcase, Folder, Link2, X,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { useToolIcons } from '@/lib/use-tool-icons';

/* --- Tokens (original) --- */
const LIGHT = {
  page:        '#F2F5FA',
  nav:         'rgba(255,255,255,0.98)',
  navBorder:   'rgba(0,0,0,0.07)',
  navText:     '#555',
  navPill:     '#F4F4F4',
  navPillText: '#555',
  card:        '#FFFFFF',
  cardBorder:  'rgba(0,0,0,0.07)',
  text:        '#111',
  sub:         '#334155',
  muted:       '#555',
  faint:       '#888',
  divider:     'rgba(0,0,0,0.07)',
  pill:        '#F4F4F4',
  accent:      '#1e293b',
  accentSoft:  'rgba(30,41,59,0.07)',
  green:       '#16a34a',
  greenSoft:   'rgba(22,163,74,0.08)',
};
const DARK = {
  page:        '#17181E',
  nav:         '#1E1F26',
  navBorder:   'rgba(255,255,255,0.07)',
  navText:     '#A8B5C2',
  navPill:     '#2a2b34',
  navPillText: '#A8B5C2',
  card:        '#1E1F26',
  cardBorder:  'rgba(255,255,255,0.07)',
  text:        '#f8fafc',
  sub:         '#A8B5C2',
  muted:       '#A8B5C2',
  faint:       '#6b7a89',
  divider:     'rgba(255,255,255,0.07)',
  pill:        '#2a2b34',
  accent:      '#3E93FF',
  accentSoft:  'rgba(62,147,255,0.10)',
  green:       '#22c55e',
  greenSoft:   'rgba(34,197,94,0.08)',
};
function useT() { const { theme } = useTheme(); return { t: theme === 'dark' ? DARK : LIGHT, isDark: theme === 'dark' }; }

/* --- Socials --- */
const SOCIALS: Record<string, { Icon: any; color: string; darkColor: string; label: string }> = {
  twitter:   { Icon: Twitter,   color: '#000',    darkColor: '#e2e8f0', label: 'X' },
  linkedin:  { Icon: Linkedin,  color: '#0A66C2', darkColor: '#4f8ef7', label: 'LinkedIn' },
  instagram: { Icon: Instagram, color: '#E1306C', darkColor: '#f472b6', label: 'Instagram' },
  github:    { Icon: Github,    color: '#24292e', darkColor: '#e2e8f0', label: 'GitHub' },
  youtube:   { Icon: Youtube,   color: '#FF0000', darkColor: '#f87171', label: 'YouTube' },
  website:   { Icon: Globe,     color: '#475569', darkColor: '#94a3b8', label: 'Website' },
};

/* --- Embed helpers (unchanged) --- */
const PORTFOLIO_EMBED_HOSTS = new Set([
  'canva.com', 'www.canva.com', 'docs.google.com',
  'figma.com', 'www.figma.com', 'public.tableau.com',
]);
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups';

function safePortfolioEmbed(raw: string): string | null {
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!PORTFOLIO_EMBED_HOSTS.has(host)) return null;
  if (host === 'canva.com' || host === 'www.canva.com') {
    let url = raw;
    if (url.includes('/preview')) url = url.replace('/preview', '/view');
    if (!url.includes('embed')) url += (url.includes('?') ? '&' : '?') + 'embed';
    return url;
  }
  return raw;
}
function safeLinkUrl(raw: string): string | null {
  if (!raw) return null;
  try { const u = new URL(raw); return u.protocol === 'https:' ? raw : null; } catch { return null; }
}

/* --- Animated gradient mesh --- */
function GradientMeshBg({ t, isDark }: { t: typeof LIGHT; isDark: boolean }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div className="p-mesh" style={{
        position: 'absolute', inset: 0,
        background: isDark
          ? `radial-gradient(ellipse 80% 60% at 15% 30%, ${t.accent}22 0%, transparent 60%),
             radial-gradient(ellipse 60% 50% at 85% 70%, ${t.accent}16 0%, transparent 55%),
             radial-gradient(ellipse 55% 40% at 55% 5%, #6B5FFF14 0%, transparent 60%)`
          : `radial-gradient(ellipse 70% 55% at 10% 25%, ${t.accent}0e 0%, transparent 60%),
             radial-gradient(ellipse 60% 50% at 90% 75%, #7c3aed09 0%, transparent 55%)`,
      }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '38%', background: `linear-gradient(to bottom, transparent, ${t.page})` }} />
    </div>
  );
}

/* --- Skill pills with stagger --- */
function SkillPillGrid({ skills, t }: { skills: string[]; t: typeof LIGHT }) {
  const toolIcon = useToolIcons();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
  const pill = {
    hidden: { opacity: 0, y: 10, scale: 0.94 },
    show:   { opacity: 1, y: 0, scale: 1, transition: { duration: 0.38, ease: [0.23, 1, 0.32, 1] as any } },
  };
  return (
    <motion.div ref={ref} variants={container} initial="hidden" animate={inView ? 'show' : 'hidden'}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {skills.map((skill: string) => {
        const icon = toolIcon(skill);
        return (
          <motion.span key={skill} variants={pill}
            style={{ fontSize: 12, fontWeight: 500, padding: '5px 11px', borderRadius: 999, background: t.card, color: t.sub, display: 'inline-flex', alignItems: 'center', gap: 5, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            {icon && <img src={icon} alt="" style={{ width: 13, height: 13, objectFit: 'contain', flexShrink: 0 }} />}
            {skill}
          </motion.span>
        );
      })}
    </motion.div>
  );
}

/* --- Hero section --- */
function HeroSection({ profile, t, isDark, certCount, projectCount, skillCount, copyLink, copied }: {
  profile: any; t: typeof LIGHT; isDark: boolean;
  certCount: number; projectCount: number; skillCount: number;
  copyLink: () => void; copied: boolean;
}) {
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 460], [1, 0]);
  const y       = useTransform(scrollY, [0, 460], [0, -36]);
  const initials     = (profile.fullName || profile.username || '?').slice(0, 2).toUpperCase();
  const socialEntries = Object.entries(profile.socialLinks ?? {}).filter(([, v]) => v);
  const stats = [
    { n: projectCount, l: 'Projects' },
    { n: certCount,    l: 'Certs' },
    { n: skillCount,   l: 'Skills' },
  ].filter(s => s.n > 0);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', overflow: 'hidden', background: t.page }}>
      <GradientMeshBg t={t} isDark={isDark} />

      <motion.div className="hero-inner" style={{ opacity, y, position: 'relative', zIndex: 1, width: '100%', maxWidth: 1060, margin: '0 auto' }}>
        <div className="hero-split">

          {/* -- Left: visual identity -- */}
          <div className="hero-left">

            {/* Avatar with spinning ring */}
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
              style={{ position: 'relative', width: 148, height: 148, marginBottom: 18, flexShrink: 0 }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                style={{ position: 'absolute', inset: -4, borderRadius: '50%', background: `conic-gradient(${t.accent}, transparent 40%, ${t.accent}77 60%, transparent 80%, ${t.accent})` }} />
              <div style={{ position: 'absolute', inset: -2, borderRadius: '50%', background: t.page }} />
              <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: t.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 800, color: t.accent, letterSpacing: '-1px' }}>
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} alt={profile.fullName || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials}
              </div>
            </motion.div>

            {/* Handle */}
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              style={{ fontSize: 13, color: t.faint, margin: '0 0 6px', fontWeight: 500 }}>
              @{profile.username}
            </motion.p>

            {/* Location */}
            {(profile.city || profile.country) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
                style={{ display: 'flex', alignItems: 'center', gap: 4, color: t.faint, fontSize: 12, marginBottom: 16 }}>
                <MapPin style={{ width: 12, height: 12, flexShrink: 0 }} />
                {[profile.city, profile.country].filter(Boolean).join(', ')}
              </motion.div>
            )}

            {/* Stats mini-card */}
            {stats.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                style={{ display: 'flex', gap: 0, marginBottom: 16, background: t.card, borderRadius: 14, overflow: 'hidden' }}>
                {stats.map((s, i) => (
                  <div key={s.l} style={{ padding: '11px 16px', textAlign: 'center', borderLeft: i > 0 ? `1px solid ${t.divider}` : 'none' }}>
                    <p style={{ fontSize: 18, fontWeight: 800, color: t.text, margin: 0, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.n}</p>
                    <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.faint, margin: '3px 0 0' }}>{s.l}</p>
                  </div>
                ))}
              </motion.div>
            )}

            {/* Social icons */}
            {socialEntries.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 12 }}>
                {socialEntries.map(([key, url]) => {
                  const s = SOCIALS[key]; if (!s) return null;
                  return (
                    <a key={key} href={url as string} target="_blank" rel="noreferrer" title={s.label}
                      style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.card, textDecoration: 'none', transition: 'transform 0.14s, box-shadow 0.14s' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = `0 4px 12px ${t.accent}22`; }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.boxShadow = ''; }}>
                      <s.Icon style={{ width: 13, height: 13, color: isDark ? s.darkColor : s.color }} />
                    </a>
                  );
                })}
              </motion.div>
            )}

            {/* Share */}
            <motion.button onClick={copyLink} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.42 }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', background: copied ? t.greenSoft : t.pill, color: copied ? t.green : t.muted, fontSize: 12, fontWeight: 600, transition: 'all 0.15s' }}>
              {copied ? <Check style={{ width: 12, height: 12 }} /> : <Link2 style={{ width: 12, height: 12 }} />}
              {copied ? 'Copied!' : 'Share profile'}
            </motion.button>
          </div>

          {/* -- Right: intro + bio + skills -- */}
          <div className="hero-right">

            {/* Greeting */}
            <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              style={{ fontSize: 18, fontWeight: 600, color: t.accent, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
              Hi! I am
            </motion.p>

            {/* Name -- gradient */}
            <motion.h1 initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
              style={{
                fontSize: 'clamp(2rem, 5vw, 3.6rem)',
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 1.0,
                margin: '0 0 24px',
                backgroundImage: `linear-gradient(135deg, ${t.accent} 0%, ${isDark ? '#7ab5ff' : '#475569'} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
              {profile.fullName || `@${profile.username}`}
            </motion.h1>

            {/* About */}
            {profile.bio && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.26 }}
                style={{ marginBottom: 28 }}>
                <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: t.faint, margin: '0 0 10px' }}>About</p>
                <p style={{ fontSize: 15, lineHeight: 1.8, color: t.sub, margin: 0, maxWidth: 540 }}>{profile.bio}</p>
              </motion.div>
            )}

            {/* Skills */}
            {(profile.skills ?? []).length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.34 }}>
                <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: t.faint, margin: '0 0 12px' }}>Skills</p>
                <SkillPillGrid skills={profile.skills as string[]} t={t} />
              </motion.div>
            )}
          </div>
        </div>

        {/* Scroll cue */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
          style={{ marginTop: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: t.faint }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Scroll</span>
          <motion.div animate={{ y: [0, 7, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 1, height: 32, background: `linear-gradient(to bottom, ${t.faint}aa, transparent)` }} />
        </motion.div>
      </motion.div>
    </div>
  );
}

/* --- Section header with gradient text --- */
function SectionHeader({ title, t, isDark }: { title: string; t: typeof LIGHT; isDark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 14 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }} style={{ marginBottom: 28 }}>
      <h2 style={{
        fontSize: 'clamp(1.7rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', margin: 0,
        backgroundImage: `linear-gradient(135deg, ${t.accent} 0%, ${isDark ? '#7ab5ff' : '#475569'} 100%)`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>
        {title}
      </h2>
    </motion.div>
  );
}

/* --- Floating side nav --- */
const NAV_ITEMS = [
  { id: 'experience',   Icon: Briefcase,     label: 'Experience' },
  { id: 'projects',     Icon: Folder,        label: 'Projects' },
  { id: 'certificates', Icon: Award,         label: 'Certificates' },
  { id: 'education',    Icon: GraduationCap, label: 'Education' },
];
function FloatingSideNav({ active, available, t }: { active: string; available: Set<string>; t: typeof LIGHT }) {
  const items = NAV_ITEMS.filter(x => available.has(x.id));
  if (!items.length) return null;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.28 }} className="p-floatnav"
      style={{ position: 'fixed', right: 22, top: '50%', transform: 'translateY(-50%)', zIndex: 50, display: 'flex', flexDirection: 'column', gap: 4, background: t.card, borderRadius: 14, padding: '7px 5px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 6px 28px rgba(0,0,0,0.10)' }}>
      {items.map(({ id, Icon, label }) => {
        const on = active === id;
        return (
          <button key={id} onClick={() => go(id)} title={label}
            style={{ width: 32, height: 32, borderRadius: 9, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? t.accentSoft : 'transparent', color: on ? t.accent : t.faint, transition: 'all 0.14s' }}
            onMouseEnter={e => { if (!on) (e.currentTarget as HTMLElement).style.background = t.pill; }}
            onMouseLeave={e => { if (!on) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
            <Icon style={{ width: 13, height: 13 }} />
          </button>
        );
      })}
    </motion.div>
  );
}

/* --- Animated timeline item --- */
function AnimatedTimelineItem({ icon: Icon, title, sub, meta, description, index, isLast, t }: {
  icon: any; title: string; sub: string; meta: string; description?: string; index: number; isLast: boolean; t: typeof LIGHT;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, x: -14 }} animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.48, delay: index * 0.08, ease: [0.23, 1, 0.32, 1] }}
      style={{ display: 'flex', gap: 12, padding: '14px 16px', paddingBottom: isLast ? 14 : 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 38 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.accentSoft, flexShrink: 0 }}>
          <Icon style={{ width: 17, height: 17, color: t.accent }} />
        </div>
        {!isLast && (
          <motion.div initial={{ scaleY: 0 }} animate={inView ? { scaleY: 1 } : {}}
            transition={{ duration: 0.65, delay: index * 0.08 + 0.22, ease: [0.23, 1, 0.32, 1] }}
            style={{ width: 2, marginTop: 8, flex: 1, minHeight: 24, backgroundImage: `linear-gradient(to bottom, ${t.accent}55, transparent)`, transformOrigin: 'top', borderRadius: 1 }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 22 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: t.text, margin: 0 }}>{title}</p>
        {sub  && <p style={{ fontSize: 13, fontWeight: 500, color: t.muted, margin: '3px 0 0' }}>{sub}</p>}
        {meta && <p style={{ fontSize: 12, color: t.faint, margin: '3px 0 0' }}>{meta}</p>}
        {description && <p style={{ fontSize: 13, lineHeight: 1.65, color: t.sub, margin: '9px 0 0', paddingLeft: 11 }}>{description}</p>}
      </div>
    </motion.div>
  );
}

/* --- 3D tilt project card --- */
function TiltProjectCard({ item, t, isDark, onOpen }: { item: any; t: typeof LIGHT; isDark: boolean; onOpen: () => void }) {
  const toolIcon = useToolIcons();
  const embedUrl = safePortfolioEmbed(item.url);
  const linkUrl  = safeLinkUrl(item.url);
  const tools: string[] = Array.isArray(item.tools) && item.tools.length > 0 ? item.tools : item.tool ? [item.tool] : [];
  const rxv = useMotionValue(0); const ryv = useMotionValue(0);
  const rx  = useSpring(rxv, { stiffness: 380, damping: 28 });
  const ry  = useSpring(ryv, { stiffness: 380, damping: 28 });
  const [noTilt, setNoTilt] = useState(false);
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNoTilt(window.matchMedia('(hover: none)').matches); }, []);

  const onMove  = (e: React.MouseEvent<HTMLDivElement>) => {
    if (noTilt) return;
    const r = e.currentTarget.getBoundingClientRect();
    rxv.set(((e.clientY - r.top) / r.height - 0.5) * -10);
    ryv.set(((e.clientX - r.left) / r.width - 0.5) * 10);
  };
  const onEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).style.boxShadow = isDark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 56px rgba(0,0,0,0.14)';
  };
  const onLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    rxv.set(0); ryv.set(0);
    (e.currentTarget as HTMLElement).style.boxShadow = '';
  };

  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 26 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.58, ease: [0.23, 1, 0.32, 1] }} style={{ perspective: 900 }}>
      <motion.div onMouseMove={onMove} onMouseEnter={onEnter} onMouseLeave={onLeave}
        style={{ rotateX: noTilt ? 0 : rx, rotateY: noTilt ? 0 : ry, transformStyle: 'preserve-3d', borderRadius: 18, overflow: 'hidden', background: t.card, transition: 'box-shadow 0.3s' }}>

        {/* Thumbnail */}
        <div style={{ position: 'relative', height: 220, overflow: 'hidden', cursor: 'pointer', background: t.pill }} onClick={onOpen}>
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.title} loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', transition: 'transform 0.5s ease' }}
              onMouseEnter={e => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.06)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLImageElement).style.transform = ''; }} />
          ) : embedUrl ? (
            <iframe src={embedUrl} title={item.title} loading="lazy" allowFullScreen sandbox={IFRAME_SANDBOX}
              style={{ border: 'none', width: 'calc(100% + 20px)', height: 440, pointerEvents: 'none' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Folder style={{ width: 32, height: 32, color: t.faint }} />
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 70, backgroundImage: `linear-gradient(to bottom, transparent, ${t.card})`, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s', background: 'rgba(0,0,0,0.32)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}>
            <span style={{ background: 'rgba(0,0,0,0.68)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 20px', borderRadius: 999, backdropFilter: 'blur(6px)' }}>
              View project
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '15px 18px 18px' }}>
          {tools.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 9 }}>
              {tools.map(tool => {
                const icon = toolIcon(tool);
                return (
                  <span key={tool} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 6, background: t.accentSoft, color: t.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {icon && <img src={icon} alt="" style={{ width: 11, height: 11, objectFit: 'contain' }} />}
                    {tool}
                  </span>
                );
              })}
            </div>
          )}
          <p style={{ fontSize: 15, fontWeight: 700, color: t.text, margin: '0 0 7px', letterSpacing: '-0.01em' }}>{item.title}</p>
          {item.description && (
            <p style={{ fontSize: 13, lineHeight: 1.6, color: t.sub, margin: '0 0 10px' }}>
              {item.description.slice(0, 160)}{item.description.length > 160 ? '...' : ''}
            </p>
          )}
          {linkUrl && (
            <a href={linkUrl} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: t.accent, textDecoration: 'none' }}>
              <ExternalLink style={{ width: 11, height: 11 }} /> Open project
            </a>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* --- Certificate card with hover lift --- */
function CertCard({ cert, t, isDark }: { cert: any; t: typeof LIGHT; isDark: boolean }) {
  const date     = cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const shortId  = cert.id ? String(cert.id).slice(0, 8).toUpperCase() : '';
  const pathItems: { title: string; coverImage: string | null }[] = cert.pathItems ?? [];
  const ref      = useRef<HTMLDivElement>(null);
  const inView   = useInView(ref, { once: true, margin: '-30px' });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 18 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.48, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ y: -5 }}
      style={{ borderRadius: 15, overflow: 'hidden', background: t.card, transition: 'box-shadow 0.25s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = isDark ? '0 14px 44px rgba(0,0,0,0.45)' : '0 14px 44px rgba(0,0,0,0.11)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
      <Link href={`/certificate/${cert.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 100, overflow: 'hidden', background: cert.coverImage ? undefined : isDark ? '#1e1b4b' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {cert.coverImage
            ? <img src={resolveCoverUrl(cert.coverImage)} alt={cert.courseName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />
            : <Award style={{ width: 28, height: 28, color: isDark ? '#818cf8' : '#6366f1' }} />}
        </div>
        <div style={{ padding: '11px 13px 14px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: t.text, margin: '0 0 5px', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
            {cert.courseName}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {date    && <span style={{ fontSize: 11, color: t.faint }}>{date}</span>}
            {shortId && <span style={{ fontSize: 11, color: t.faint }}>#{shortId}</span>}
          </div>
          {pathItems.length > 0 && (
            <p style={{ fontSize: 10, color: t.accent, margin: '5px 0 0', fontWeight: 700, letterSpacing: '0.04em' }}>
              {pathItems.length} ITEM{pathItems.length !== 1 ? 'S' : ''}
            </p>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

/* --- Empty section --- */
function EmptySection({ label, t }: { label: string; t: typeof LIGHT }) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 24px', background: t.card, borderRadius: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 500, color: t.muted, margin: 0 }}>No {label.toLowerCase()} added yet.</p>
    </div>
  );
}

/* --- Project modal (unchanged) --- */
function ProjectModal({ item, profile, t, isDark, onClose }: { item: any; profile: any; t: typeof LIGHT; isDark: boolean; onClose: () => void }) {
  const toolIcon = useToolIcons();
  const embedUrl = safePortfolioEmbed(item.url);
  const linkUrl  = safeLinkUrl(item.url);
  const tools: string[] = Array.isArray(item.tools) && item.tools.length > 0 ? item.tools : item.tool ? [item.tool] : [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="modal-inner" style={{ width: '100%', maxWidth: 1080, overflow: 'hidden', background: t.card, display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.45)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {tools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {tools.map(tool => (
                  <span key={tool} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 100, background: t.pill, color: t.sub, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {(() => { const icon = toolIcon(tool); return icon ? <img src={icon} alt="" style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0 }} /> : null; })()}
                    {tool}
                  </span>
                ))}
              </div>
            )}
            <p className="modal-title" style={{ fontWeight: 700, color: t.text, margin: 0 }}>{item.title}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: t.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: t.accent }}>
                {profile.avatarUrl ? <img src={profile.avatarUrl} alt={profile.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (profile.fullName || '?').slice(0, 2).toUpperCase()}
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: t.sub }}>{profile.fullName || profile.username}</span>
            </div>
            {item.description && <p style={{ fontSize: 14, lineHeight: 1.7, color: t.sub, margin: '12px 0 0', maxWidth: 620 }}>{item.description}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {linkUrl && (
              <a href={linkUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: t.pill, color: t.muted, textDecoration: 'none' }}>
                <ExternalLink style={{ width: 13, height: 13 }} /> Open
              </a>
            )}
            <button onClick={onClose} style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', cursor: 'pointer', background: t.pill, color: t.muted }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
        <div className="modal-content" style={{ flex: 1, minHeight: 0 }}>
          {embedUrl ? (
            <iframe src={embedUrl} title={item.title} allowFullScreen sandbox={IFRAME_SANDBOX} style={{ border: 'none', width: '100%', height: '100%', minHeight: 550, display: 'block' }} />
          ) : item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 550, gap: 12 }}>
              <ExternalLink style={{ width: 32, height: 32, color: t.faint }} />
              {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600, color: t.accent, textDecoration: 'none' }}>Open project</a>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Page --- */
export default function StudentPublicProfile() {
  const { username }        = useParams<{ username: string }>();
  const { t, isDark }       = useT();
  const { toggle: toggleTheme } = useTheme();
  const { logoUrl }         = useTenant();

  const [data, setData]                   = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [notFound, setNotFound]           = useState(false);
  const [copied, setCopied]               = useState(false);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [showNav, setShowNav]             = useState(false);
  const [activeSection, setActiveSection] = useState('experience');

  useEffect(() => {
    if (!username) return;
    fetch(`/api/student-profile/${encodeURIComponent(username)}`)
      .then(r => { if (r.status === 404) { setNotFound(true); setLoading(false); return null; } return r.json(); })
      .then(d => { if (!d) return; setData(d); setLoading(false); })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [username]);

  useEffect(() => {
    const fn = () => setShowNav(window.scrollY > window.innerHeight * 0.55);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => {
    if (!data) return;
    const obs = new IntersectionObserver(
      entries => { for (const e of entries) { if (e.isIntersecting) setActiveSection(e.target.id); } },
      { threshold: 0.3, rootMargin: '-15% 0px -55% 0px' },
    );
    ['experience', 'projects', 'certificates', 'education'].forEach(id => {
      const el = document.getElementById(id); if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [data]);

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.page }}>
      <Loader2 style={{ width: 20, height: 20, color: t.faint }} className="animate-spin" />
    </div>
  );
  if (notFound) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: t.page, textAlign: 'center', padding: '0 24px' }}>
      <p style={{ fontSize: 28, fontWeight: 800, color: t.text, margin: 0 }}>404</p>
      <p style={{ fontSize: 14, color: t.muted, margin: 0 }}>This profile doesn&apos;t exist.</p>
      <Link href="/" style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: t.accent }}>Go home</Link>
    </div>
  );

  const { profile, certificates, virtualExpCerts, pathCerts, certificationCerts } = data;
  const portfolioItems = (profile.portfolioItems ?? []) as any[];
  const allCerts       = [...(certificates ?? []), ...(virtualExpCerts ?? []), ...(pathCerts ?? []), ...(certificationCerts ?? [])];
  const hasWork        = (profile.workExperience ?? []).length > 0;
  const hasEdu         = (profile.education ?? []).length > 0;
  const hasCerts       = allCerts.length > 0;
  const hasPortfolio   = portfolioItems.length > 0;
  const available      = new Set([
    ...(hasWork      ? ['experience']   : []),
    ...(hasPortfolio ? ['projects']     : []),
    ...(hasCerts     ? ['certificates'] : []),
    ...(hasEdu       ? ['education']    : []),
  ]);

  return (
    <div style={{ minHeight: '100vh', background: t.page }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800&display=swap');
        * { font-family: 'Inter', sans-serif; }

        @keyframes p-mesh-anim {
          0%, 100% { background-position: 0% 50%; }
          50%       { background-position: 100% 50%; }
        }
        .p-mesh { background-size: 300% 300%; animation: p-mesh-anim 14s ease infinite; }

        /* Hero two-column split */
        .hero-split { display: flex; flex-direction: column; align-items: center; gap: 32px; }
        .hero-left  { display: flex; flex-direction: column; align-items: center; text-align: center; flex-shrink: 0; }
        .hero-right { display: flex; flex-direction: column; align-items: center; text-align: center; width: 100%; }
        @media (min-width: 900px) {
          .hero-split { flex-direction: row; align-items: flex-start; gap: 72px; }
          .hero-left  { width: 260px; }
          .hero-right { flex: 1; align-items: flex-start; text-align: left; }
        }

        /* Hero inner padding */
        .hero-inner { padding: 74px 16px 40px; }
        @media (min-width: 640px) { .hero-inner { padding: 80px 28px 56px; } }

        /* Responsive sections wrapper */
        .p-sections { max-width: 860px; margin: 0 auto; padding: 0 16px 80px; }
        @media (min-width: 640px) { .p-sections { padding: 0 24px 120px; } }

        /* Projects grid */
        .p-projects-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 500px) { .p-projects-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; } }

        /* Certs grid */
        .p-certs-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        @media (min-width: 500px) { .p-certs-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; } }

        /* Floating nav hidden on mobile */
        .p-floatnav { display: none !important; }
        @media (min-width: 900px) { .p-floatnav { display: flex !important; } }

        /* Modal */
        .modal-overlay { padding: 12px; }
        .modal-inner   { border-radius: 16px; max-height: 95vh; }
        .modal-header  { padding: 16px 18px; gap: 12px; }
        .modal-title   { font-size: 15px; }
        .modal-content { margin: 0 16px 18px; overflow: hidden; }
        @media (min-width: 768px) {
          .modal-overlay { padding: 24px 32px; }
          .modal-inner   { border-radius: 24px; max-height: 90vh; }
          .modal-header  { padding: 24px 32px; gap: 24px; }
          .modal-title   { font-size: 18px; }
          .modal-content { margin: 0 32px 28px; }
        }
      `}</style>

      {/* -- Navbar -- */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, background: t.nav, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/"><img src={logoUrl || undefined} alt="" style={{ height: 26, width: 'auto' }} /></Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={toggleTheme} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: t.navText }}>
              {isDark ? <Sun style={{ width: 15, height: 15 }} /> : <Moon style={{ width: 15, height: 15 }} />}
            </button>
            <button onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: t.navPill, color: copied ? t.green : t.navPillText, fontSize: 12, fontWeight: 600, transition: 'color 0.15s' }}>
              {copied ? <Check style={{ width: 13, height: 13 }} /> : <Link2 style={{ width: 13, height: 13 }} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      </nav>

      {/* -- Hero -- */}
      <HeroSection profile={profile} t={t} isDark={isDark}
        certCount={allCerts.length} projectCount={portfolioItems.length}
        skillCount={(profile.skills ?? []).length}
        copyLink={copyLink} copied={copied} />

      {/* -- Scroll sections -- */}
      <div className="p-sections">

        {/* Experience */}
        {hasWork ? (
          <section id="experience" style={{ paddingTop: 48 }}>
            <SectionHeader title="Experience" t={t} isDark={isDark} />
            <div style={{ background: t.card, borderRadius: 18, overflow: 'hidden' }}>
              {profile.workExperience.map((job: any, i: number) => (
                <AnimatedTimelineItem key={job.id || i} icon={Briefcase}
                  title={job.title || 'Role'} sub={job.company}
                  meta={[job.start_year, job.current ? 'Present' : job.end_year].filter(Boolean).join(' - ')}
                  description={job.description}
                  index={i} isLast={i === profile.workExperience.length - 1} t={t} />
              ))}
            </div>
          </section>
        ) : <div id="experience" />}

        {/* Projects */}
        {hasPortfolio ? (
          <section id="projects" style={{ paddingTop: 48 }}>
            <SectionHeader title="Projects" t={t} isDark={isDark} />
            <div className="p-projects-grid">
              {portfolioItems.map((item: any) => (
                <TiltProjectCard key={item.id} item={item} t={t} isDark={isDark} onOpen={() => setSelectedProject(item)} />
              ))}
            </div>
          </section>
        ) : <div id="projects" />}

        {/* Certificates */}
        {hasCerts ? (
          <section id="certificates" style={{ paddingTop: 48 }}>
            <SectionHeader title="Certificates" t={t} isDark={isDark} />

            {(certificates ?? []).length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.faint, margin: '0 0 14px' }}>Courses</p>
                <div className="p-certs-grid">
                  {(certificates ?? []).map((cert: any) => (
                    <CertCard key={cert.id} cert={cert} t={t} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {(pathCerts ?? []).length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.faint, margin: '0 0 14px' }}>Learning Paths</p>
                <div className="p-certs-grid">
                  {(pathCerts ?? []).map((cert: any) => (
                    <CertCard key={cert.id} cert={cert} t={t} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {(certificationCerts ?? []).length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.faint, margin: '0 0 14px' }}>Certifications</p>
                <div className="p-certs-grid">
                  {(certificationCerts ?? []).map((cert: any) => (
                    <CertCard key={cert.id} cert={cert} t={t} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}

            {(virtualExpCerts ?? []).length > 0 && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.faint, margin: '0 0 14px' }}>Virtual Experience</p>
                <div className="p-certs-grid">
                  {(virtualExpCerts ?? []).map((cert: any) => (
                    <CertCard key={cert.id} cert={cert} t={t} isDark={isDark} />
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : <div id="certificates" />}

        {/* Education */}
        {hasEdu ? (
          <section id="education" style={{ paddingTop: 48 }}>
            <SectionHeader title="Education" t={t} isDark={isDark} />
            <div style={{ background: t.card, borderRadius: 18, overflow: 'hidden' }}>
              {profile.education.map((ed: any, i: number) => (
                <AnimatedTimelineItem key={ed.id || i} icon={GraduationCap}
                  title={ed.school || 'Institution'}
                  sub={[ed.degree, ed.field].filter(Boolean).join(' · ')}
                  meta={[ed.start_year, ed.current ? 'Present' : ed.end_year].filter(Boolean).join(' - ')}
                  index={i} isLast={i === profile.education.length - 1} t={t} />
              ))}
            </div>
          </section>
        ) : <div id="education" />}

        {/* All empty */}
        {!hasWork && !hasPortfolio && !hasCerts && !hasEdu && (
          <div style={{ paddingTop: 48 }}>
            <EmptySection label="Content" t={t} />
          </div>
        )}
      </div>

      {/* -- Floating nav -- */}
      <AnimatePresence>
        {showNav && <FloatingSideNav key="fn" active={activeSection} available={available} t={t} />}
      </AnimatePresence>

      {/* -- Project modal -- */}
      {selectedProject && (
        <ProjectModal item={selectedProject} profile={profile} t={t} isDark={isDark} onClose={() => setSelectedProject(null)} />
      )}
    </div>
  );
}
