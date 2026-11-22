'use client';

// A learner's public portfolio (/s/username), the page they share with employers: one profile card
// (photo, name, current role, location, bio, links, counts), then Skills, Experience, Projects,
// Certificates and Education, each in its own card. Empty sections are hidden. A project opens in a
// preview (its live embed or screenshot); a certificate opens its certificate page. Follows the
// viewer's theme; icons are Phosphor, as the rest of the platform.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { useToolIcons } from '@/lib/use-tool-icons';
import { useC } from '@/lib/theme';
import { Sk } from '@/components/student/shared';
import { FRAMED_CARD } from '@/components/CardMeta';
import { DISPLAY_FONT, btnStyle } from '@/components/dashboard/subscriptions/ui';
import {
  ArrowSquareOut, Briefcase, CalendarBlank, Certificate, Check, FolderSimple, GithubLogo, Globe, GraduationCap,
  InstagramLogo, LinkSimple, LinkedinLogo, MapPin, Moon, Sun, X, XLogo, YoutubeLogo,
} from '@phosphor-icons/react';

const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)]';
const SMALL_BTN = 'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-semibold transition-opacity hover:opacity-90';

/* --- Socials --- */
const SOCIALS: Record<string, { Icon: typeof Globe; color?: string; label: string }> = {
  twitter:   { Icon: XLogo,         label: 'X' },
  linkedin:  { Icon: LinkedinLogo,  color: '#0A66C2', label: 'LinkedIn' },
  instagram: { Icon: InstagramLogo, color: '#E1306C', label: 'Instagram' },
  github:    { Icon: GithubLogo,    label: 'GitHub' },
  youtube:   { Icon: YoutubeLogo,   color: '#FF0000', label: 'YouTube' },
  website:   { Icon: Globe,         label: 'Website' },
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

const TYPE_LABEL: Record<string, string> = {
  certification: 'Certification', learning_path: 'Learning path', virtual_experience: 'Virtual experience', course: 'Course',
};
// Strongest first: certifications, then paths, experiences and courses; newest first within each.
const TYPE_ORDER = ['certification', 'learning_path', 'virtual_experience', 'course'];
const toolsOf = (item: any): string[] => (Array.isArray(item.tools) && item.tools.length > 0 ? item.tools : item.tool ? [item.tool] : []);
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
const years = (e: any) => [e.start_year, e.current ? 'Present' : e.end_year].filter(Boolean).join(' - ');
// Current entries first, then the latest start year.
const newestFirst = (a: any, b: any) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || Number(b.start_year || 0) - Number(a.start_year || 0);

/** A white card with a heading. */
function Section({ title, children, C }: { title: string; children: React.ReactNode; C: ReturnType<typeof useC> }) {
  return (
    <section className={`min-w-0 rounded-2xl p-5 ${CARD_SHADOW}`} style={{ background: C.card }}>
      <h2 className="mb-3 text-lg font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h2>
      {children}
    </section>
  );
}

/** A tool name with its logo, as a small chip. */
function ToolChip({ name, small, C }: { name: string; small?: boolean; C: ReturnType<typeof useC> }) {
  const toolIcon = useToolIcons();
  const icon = toolIcon(name);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg font-medium ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12.5px]'}`} style={{ background: C.pill, color: C.text }}>
      {icon && <img src={icon} alt="" className={`${small ? 'h-3 w-3' : 'h-3.5 w-3.5'} flex-shrink-0 object-contain`}/>}
      {name}
    </span>
  );
}

/** Work or education as a dashed timeline, newest first. */
function Timeline({ entries, Icon, title, sub, C }: {
  entries: any[]; Icon: typeof Briefcase; title: (e: any) => string; sub: (e: any) => string; C: ReturnType<typeof useC>;
}) {
  return (
    <ol>
      {entries.map((e, i) => (
        <li key={e.id ?? i} className="relative flex gap-3 pb-5 last:pb-0">
          {i < entries.length - 1 && <span aria-hidden className="absolute bottom-0 left-[17px] top-10" style={{ borderLeft: `2px dashed ${C.divider}` }}/>}
          <span className="relative z-10 grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: C.pill, color: C.text }}>
            <Icon size={18} weight="duotone"/>
          </span>
          <div className="min-w-0">
            <p className="font-semibold" style={{ color: C.text }}>{title(e)}</p>
            {sub(e) && <p className="text-[13px]" style={{ color: C.text }}>{sub(e)}</p>}
            {years(e) && <p className="text-[13px]" style={{ color: C.muted }}>{years(e)}</p>}
            {e.description && <p className="mt-1 text-sm" style={{ color: C.text }}>{e.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ProjectCard({ item, onOpen, C }: { item: any; onOpen: () => void; C: ReturnType<typeof useC> }) {
  const embedUrl = safePortfolioEmbed(item.url);
  const linkUrl = safeLinkUrl(item.url);
  const tools = toolsOf(item);
  return (
    <div className={FRAMED_CARD} style={{ background: C.card, cursor: 'default' }}>
      <button type="button" onClick={onOpen} aria-label={`View ${item.title}`} className="relative block aspect-video w-full overflow-hidden" style={{ background: C.pill }}>
        {item.thumbnail_url
          ? <img src={item.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.05]"/>
          : embedUrl
            ? <iframe src={embedUrl} title={item.title} loading="lazy" sandbox={IFRAME_SANDBOX} tabIndex={-1} className="pointer-events-none h-[200%] w-full border-0"/>
            : <span className="grid h-full w-full place-items-center" style={{ color: C.faint }}><FolderSimple size={30} weight="duotone"/></span>}
      </button>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3.5">
        <div>
          <p className="text-[15px] font-bold leading-5" style={{ color: C.text }}>{item.title}</p>
          {item.description && <p className="mt-1 line-clamp-3 text-[13px]" style={{ color: C.muted }}>{item.description}</p>}
        </div>
        {tools.length > 0 && <div className="flex flex-wrap gap-1.5">{tools.map(tool => <ToolChip key={tool} name={tool} small C={C}/>)}</div>}
        {/* The picture opens the preview; this opens the project itself. */}
        {linkUrl && (
          <a href={linkUrl} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 self-start text-[13px] font-semibold" style={{ color: C.text }}>
            <ArrowSquareOut size={13} weight="bold"/> Open project
          </a>
        )}
      </div>
    </div>
  );
}

function CertCard({ cert, C }: { cert: any; C: ReturnType<typeof useC> }) {
  const toolIcon = useToolIcons();
  const [broken, setBroken] = useState(false);
  const date = cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const tags: string[] = cert.tags ?? [];
  const tools: string[] = cert.tools ?? [];
  return (
    <Link href={`/certificate/${cert.id}`} target="_blank" rel="noreferrer" className={FRAMED_CARD} style={{ background: C.card }}>
      <div className="relative grid aspect-video w-full place-items-center overflow-hidden" style={{ background: C.pill, color: '#16a34a' }}>
        {cert.coverImage && !broken
          ? <img src={resolveCoverUrl(cert.coverImage)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"/>
          : <Certificate size={30} weight="duotone"/>}
        <span className="absolute left-0 top-3 px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>{TYPE_LABEL[cert.contentType] ?? 'Course'}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-3.5">
        <div>
          <p className="line-clamp-2 text-[15px] font-bold leading-5" style={{ color: C.text }}>{cert.courseName}</p>
          {date && <p className="mt-0.5 text-xs" style={{ color: C.muted }}>Issued {date}</p>}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map(tag => <span key={tag} className="rounded-md px-2 py-0.5 text-[11.5px] font-medium" style={{ background: C.pill, color: C.text }}>{tag}</span>)}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: C.text }}><ArrowSquareOut size={13} weight="bold"/> View certificate</span>
          {tools.length > 0 && (
            <span className="flex items-center gap-1.5" title={tools.join(', ')}>
              {tools.map(tool => { const icon = toolIcon(tool); return icon ? <img key={tool} src={icon} alt={tool} className="h-[18px] w-[18px] object-contain"/> : null; })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* --- Project preview (the live embed, the screenshot, or a link) --- */
function ProjectModal({ item, profile, onClose, C }: { item: any; profile: any; onClose: () => void; C: ReturnType<typeof useC> }) {
  const embedUrl = safePortfolioEmbed(item.url);
  const linkUrl = safeLinkUrl(item.url);
  const tools = toolsOf(item);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 md:p-8" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={item.title} className="flex max-h-[95vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-2xl shadow-2xl md:max-h-[90vh] md:rounded-3xl"
        style={{ background: C.card }} onClick={e => e.stopPropagation()}>
        <div className="flex flex-shrink-0 items-start justify-between gap-4 p-4 md:p-6">
          <div className="min-w-0 flex-1">
            {tools.length > 0 && <div className="mb-2.5 flex flex-wrap gap-1.5">{tools.map(tool => <ToolChip key={tool} name={tool} C={C}/>)}</div>}
            <p className="text-base font-semibold md:text-lg" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{item.title}</p>
            <p className="mt-1 text-[13px]" style={{ color: C.muted }}>{profile.fullName || profile.username}</p>
            {item.description && <p className="mt-3 max-w-[620px] text-sm leading-relaxed" style={{ color: C.text }}>{item.description}</p>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" className={SMALL_BTN} style={btnStyle('sec', C)}><ArrowSquareOut size={14} weight="bold"/> Open</a>}
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-xl" style={btnStyle('sec', C)}><X size={15} weight="bold"/></button>
          </div>
        </div>
        <div className="mx-4 mb-4 min-h-0 flex-1 overflow-hidden md:mx-6 md:mb-6">
          {embedUrl ? (
            <iframe src={embedUrl} title={item.title} allowFullScreen sandbox={IFRAME_SANDBOX} className="block h-full min-h-[550px] w-full border-0"/>
          ) : item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.title} className="block h-full w-full object-contain"/>
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3" style={{ color: C.faint }}>
              <ArrowSquareOut size={30}/>
              {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold" style={{ color: C.text }}>Open project</a>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Page --- */
export default function StudentPublicProfile() {
  const { username } = useParams<{ username: string }>();
  const C = useC();
  const { theme, toggle: toggleTheme } = useTheme();
  const { logoUrl, logoDarkUrl, orgName, appName } = useTenant();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // The profile exists but could not be loaded (server or network): a retry, not a 404.
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any>(null);

  useEffect(() => {
    if (!username) return;
    fetch(`/api/student-profile/${encodeURIComponent(username)}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null; }
        if (!r.ok) { setUnavailable(true); setLoading(false); return null; }
        return r.json();
      })
      .then(d => { if (!d) return; setData(d); setLoading(false); })
      .catch(() => { setUnavailable(true); setLoading(false); });
  }, [username]);

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  const logo = theme === 'dark' ? (logoDarkUrl || logoUrl) : logoUrl;

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: C.page, color: C.text }}>
      <header className="sticky top-0 z-40" style={{ background: C.card, borderBottom: `1px solid ${C.divider}` }}>
        <div className="mx-auto flex max-w-[880px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center">
            {logo ? <img src={logo} alt={orgName || appName || ''} className="h-7 w-auto max-w-[160px] object-contain"/> : <span className="truncate font-bold" style={{ fontFamily: DISPLAY_FONT }}>{orgName || appName}</span>}
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: C.muted }}>
              {theme === 'dark' ? <Sun size={16} weight="bold"/> : <Moon size={16} weight="bold"/>}
            </button>
            {data && (
              <button type="button" onClick={copyLink} className={SMALL_BTN} style={btnStyle('sec', C)}>
                {copied ? <Check size={15} weight="bold" style={{ color: '#12A150' }}/> : <LinkSimple size={15} weight="bold"/>}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-[880px] gap-4 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
    </div>
  );

  // Loading: the profile card and two sections in outline, as the page will look.
  if (loading) return shell(
    <>
      <section className={`rounded-2xl p-5 ${CARD_SHADOW}`} style={{ background: C.card }} aria-busy="true">
        <div className="flex gap-5"><Sk w={96} h={96} r={99}/><div className="flex-1 space-y-2.5 pt-1"><Sk w="45%" h={28}/><Sk w="35%" h={14}/><Sk w="55%" h={12}/><Sk h={12}/><Sk w="80%" h={12}/></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2.5">{[0, 1, 2].map(i => <Sk key={i} h={62} r={12}/>)}</div>
      </section>
      {[0, 1].map(i => (
        <section key={i} className={`space-y-3 rounded-2xl p-5 ${CARD_SHADOW}`} style={{ background: C.card }}>
          <Sk w={120} h={18}/><Sk h={14}/><Sk w="70%" h={14}/>
        </section>
      ))}
    </>,
  );
  if (notFound) return shell(
    <div className="py-24 text-center">
      <p className="text-xl font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Profile not found</p>
      <p className="mt-1 text-sm" style={{ color: C.muted }}>This profile does not exist.</p>
      <Link href="/" className="mt-3 inline-block text-sm font-semibold" style={{ color: C.text }}>Go home</Link>
    </div>,
  );
  if (unavailable) return shell(
    <div className="py-24 text-center">
      <p className="text-sm" style={{ color: C.muted }}>We could not load this profile right now.</p>
      <button type="button" onClick={() => window.location.reload()} className={`${SMALL_BTN} mt-3`} style={btnStyle('sec', C)}>Try again</button>
    </div>,
  );

  const { profile } = data;
  const certs: any[] = [...(data.certificates ?? [])].sort((a, b) =>
    TYPE_ORDER.indexOf(a.contentType) - TYPE_ORDER.indexOf(b.contentType) || String(b.issuedAt).localeCompare(String(a.issuedAt)));
  const projects: any[] = profile.portfolioItems ?? [];
  const skills: string[] = profile.skills ?? [];
  const work: any[] = [...(profile.workExperience ?? [])].sort(newestFirst);
  const education: any[] = [...(profile.education ?? [])].sort(newestFirst);
  const currentJob = work.find(w => w.current);
  const headline = currentJob ? [currentJob.title, currentJob.company].filter(Boolean).join(' at ') : '';
  const place = [profile.city, profile.country].filter(Boolean).join(', ');
  const since = profile.memberSince ? new Date(profile.memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const socials = Object.entries(profile.socialLinks ?? {}).filter(([key, url]) => SOCIALS[key] && safeLinkUrl(String(url)));

  return shell(
    <>
      {/* Profile card */}
      <section className={`min-w-0 rounded-2xl p-5 ${CARD_SHADOW}`} style={{ background: C.card }}>
        <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <span className="grid h-24 w-24 place-items-center overflow-hidden rounded-full text-3xl font-semibold" style={{ background: C.pill, color: C.text, fontFamily: DISPLAY_FONT }}>
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover"/> : initialsOf(profile.fullName || profile.username || '')}
          </span>
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold leading-9" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{profile.fullName || profile.username}</h1>
            {headline && <p className="mt-0.5 text-[15px]" style={{ color: C.text }}>{headline}</p>}
            <p className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px]" style={{ color: C.muted }}>
              {place && <span className="inline-flex items-center gap-1"><MapPin size={14} weight="bold"/>{place}</span>}
              {profile.username && <span>@{profile.username}</span>}
              {since && <span className="inline-flex items-center gap-1"><CalendarBlank size={14} weight="bold"/>Learning since {since}</span>}
            </p>
            {profile.bio && <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed" style={{ color: C.text }}>{profile.bio}</p>}
            {socials.length > 0 && (
              <div className="mt-3.5 flex flex-wrap gap-2">
                {socials.map(([key, url]) => {
                  const s = SOCIALS[key];
                  return (
                    <a key={key} href={String(url)} target="_blank" rel="noreferrer" title={s.label} aria-label={s.label}
                      className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: s.color ?? C.text }}>
                      <s.Icon size={17} weight={s.Icon === Globe ? 'bold' : 'fill'}/>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {([['Projects', projects.length], ['Certificates', certs.length], ['Skills', skills.length]] as const).map(([label, n]) => (
            <div key={label} className="rounded-xl px-3 py-2.5" style={{ background: `color-mix(in srgb, ${C.pill} 55%, ${C.card})` }}>
              <b className="block text-[22px] font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{n}</b>
              <span className="text-xs" style={{ color: C.muted }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {skills.length > 0 && (
        <Section title="Skills" C={C}>
          <div className="flex flex-wrap gap-1.5">{skills.map(skill => <ToolChip key={skill} name={skill} C={C}/>)}</div>
        </Section>
      )}

      {work.length > 0 && (
        <Section title="Experience" C={C}>
          <Timeline entries={work} Icon={Briefcase} title={e => e.title} sub={e => e.company} C={C}/>
        </Section>
      )}

      {projects.length > 0 && (
        <Section title="Projects" C={C}>
          <div className="grid gap-3.5 sm:grid-cols-2">
            {projects.map((item, i) => <ProjectCard key={item.id ?? i} item={item} onOpen={() => setSelectedProject(item)} C={C}/>)}
          </div>
        </Section>
      )}

      {certs.length > 0 && (
        <Section title="Certificates" C={C}>
          <div className="grid gap-3.5 min-[460px]:grid-cols-2 md:grid-cols-3">
            {certs.map(cert => <CertCard key={cert.id} cert={cert} C={C}/>)}
          </div>
        </Section>
      )}

      {education.length > 0 && (
        <Section title="Education" C={C}>
          <Timeline entries={education} Icon={GraduationCap} title={e => e.school} sub={e => [e.degree, e.field].filter(Boolean).join(', ')} C={C}/>
        </Section>
      )}

      {selectedProject && <ProjectModal item={selectedProject} profile={profile} onClose={() => setSelectedProject(null)} C={C}/>}
    </>,
  );
}
