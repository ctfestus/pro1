'use client';

// Shared primitives for the simulated-workplace surfaces (mail client + team chat)
// used by VirtualExperienceTaker and AssignmentExperiencePlayer. Presentational
// only: all progress/AI-review logic stays in the players.

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, FileSpreadsheet, FileText, FileImage, FileCode2, File as FileIcon, Paperclip } from 'lucide-react';
import { LinkedInIcon } from '@/components/LinkedInIcon';

export interface Person {
  name: string;
  email?: string;
  title?: string;
  avatarUrl?: string;
  company?: string;
  bio?: string;
  linkedinUrl?: string;
  expertise?: string[];
  color: string;
}

// -- identity helpers --------------------------------------------------------

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function companyDomain(company?: string, title?: string): string {
  const base = (company || (title || '').split(' - ')[0] || 'workspace')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${base || 'workspace'}.com`;
}

export function personEmail(name: string, domain: string): string {
  const local = name.toLowerCase().trim().replace(/[^a-z\s]/g, '').replace(/\s+/g, '.');
  return `${local || 'me'}@${domain}`;
}

export function firstNameOf(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || name;
}

export function initialsOf(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// Deterministic colleague names for facepiles: seeded by company so a given
// experience always shows the same team.
const COLLEAGUE_POOL = [
  'Amara Diallo', 'Kwame Mensah', 'Lerato Mokoena', 'Chidi Okafor',
  'Zainab Bello', 'Thandi Nkosi', 'Sefako Asante', 'Nia Abara',
];
export function colleaguesFor(seed: string, count = 2): string[] {
  const h = hashStr(seed || 'team');
  const out: string[] = [];
  for (let i = 0; out.length < count && i < COLLEAGUE_POOL.length; i++) {
    const pick = COLLEAGUE_POOL[(h + i * 3) % COLLEAGUE_POOL.length];
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}

// -- simulated workday clock -------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Deterministic timestamp for a message: the experience plays out across a
// simulated work week. `dayIdx` = mission index, `seq` = position in the lesson.
export function workStamp(dayIdx: number, seq: number, key?: string): { day: string; time: string; full: string } {
  const day = DAY_NAMES[Math.max(0, dayIdx) % DAY_NAMES.length];
  const jitter = key ? hashStr(key) % 11 : 0;
  let mins = 9 * 60 + 2 + seq * 47 + jitter; // 9:02 AM onwards
  if (mins > 16 * 60 + 45) mins = 16 * 60 + 45 - (jitter % 25); // keep inside the workday
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 > 12 ? h24 - 12 : h24;
  const time = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  return { day, time, full: `${day} ${time}` };
}

// Deterministic pseudo file size so attachments read like real files.
export function fileSizeFor(name: string): string {
  const h = hashStr(name || 'file');
  const kb = 24 + (h % 940);
  if (kb > 700) return `${(kb / 1000).toFixed(1)} MB`;
  return `${kb} KB`;
}

// -- sounds (all soft, all optional) ------------------------------------------

// The learner's sound switch, kept per browser. Read on every play so turning it off also stops
// typing that is already under way. Unreadable storage means the default: on.
const SOUND_KEY = 've-sound';
export function workplaceSoundOn(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}
export function setWorkplaceSound(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* this visit only */ }
}

function audioCtx(): AudioContext | null {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    return new Ctx() as AudioContext;
  } catch { return null; }
}

// Soft two-tone "new message" chime.
export function playArrivalChime() {
  if (!workplaceSoundOn()) return;
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    g.connect(ctx.destination);
    [880, 1174.66].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      o.start(ctx.currentTime + i * 0.11);
      o.stop(ctx.currentTime + 0.6);
    });
    setTimeout(() => { try { ctx.close(); } catch {} }, 800);
  } catch { /* no audio */ }
}

function playTypingClick() {
  if (!workplaceSoundOn()) return;
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const n = Math.floor(ctx.sampleRate * 0.025);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) * 0.18;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.14;
    src.connect(g); g.connect(ctx.destination);
    src.start(); src.onended = () => { try { ctx.close(); } catch {} };
  } catch { /* no audio */ }
}

export function startTypingSound(durationMs: number) {
  const end = Date.now() + durationMs;
  (function tick() { if (Date.now() >= end) return; playTypingClick(); setTimeout(tick, 70 + Math.floor(Math.random() * 110)); })();
}

// Plain-text snippet of an email body, for quoted history under replies.
export function quoteSnippet(html?: string, max = 110): string {
  const txt = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!txt) return '';
  return txt.length > max ? `${txt.slice(0, max).trimEnd()}...` : txt;
}

// Tracks which messages have already "arrived" this session so the new-mail
// animation and chime only fire the first time a message is seen.
const arrived = new Set<string>();
export function firstArrival(id: string): boolean {
  if (arrived.has(id)) return false;
  arrived.add(id);
  return true;
}

// Re-anchor the viewport on a card's interaction zone after an action changed
// its layout (composer collapsed, thread grew), so the student never has to
// scroll back to find where they were. MailCard/ChatCard tag their interaction
// area with `ve-zone-<reqId>`.
export function anchorZone(reqId: string, delay = 90) {
  if (typeof document === 'undefined') return;
  setTimeout(() => {
    try {
      document.getElementById(`ve-zone-${reqId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch { /* older browsers */ }
  }, delay);
}

// -- small visual atoms --------------------------------------------------------

export function PersonAvatar({ name, size, color, presence, avatarUrl, title, company, bio, linkedinUrl, expertise, isDark = false }: {
  name: string;
  size: number;
  color: string;
  presence?: 'active' | 'away' | 'none';
  avatarUrl?: string;
  title?: string;
  email?: string;
  company?: string;
  bio?: string;
  linkedinUrl?: string;
  expertise?: string[];
  isDark?: boolean;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [profilePos, setProfilePos] = useState({ top: 0, left: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seed = encodeURIComponent(name);
  const dotSize = Math.max(8, Math.round(size * 0.28));
  const profileBg = isDark ? '#222329' : '#ffffff';
  const profileText = isDark ? '#f4f5f7' : '#172033';
  const profileMuted = isDark ? '#aeb4bf' : '#5f6b7a';
  const profileLine = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.10)';
  const showProfile = (target: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = target.getBoundingClientRect();
    const cardWidth = 280;
    const roomOnRight = rect.right + 8 + cardWidth <= window.innerWidth - 12;
    const roomOnLeft = rect.left - 8 - cardWidth >= 12;
    const left = roomOnRight ? rect.right + 8 : roomOnLeft ? rect.left - cardWidth - 8 : Math.max(12, Math.min(rect.left, window.innerWidth - cardWidth - 12));
    const top = Math.max(12, Math.min(rect.top - 16, window.innerHeight - 240));
    setProfilePos({ top, left });
    setProfileOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setProfileOpen(false), 180);
  };
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={`View ${name}'s profile`}
      aria-expanded={profileOpen}
      onMouseEnter={e => showProfile(e.currentTarget)}
      onMouseLeave={scheduleClose}
      onFocus={e => showProfile(e.currentTarget)}
      onBlur={scheduleClose}
      onClick={e => profileOpen ? setProfileOpen(false) : showProfile(e.currentTarget)}
      onKeyDown={e => { if (e.key === 'Escape') setProfileOpen(false); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); profileOpen ? setProfileOpen(false) : showProfile(e.currentTarget); } }}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0, cursor: 'pointer', outlineOffset: 3 }}>
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', position: 'relative', background: color }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.floor(size * 0.33), fontWeight: 800, color: '#fff' }}>
          {initialsOf(name)}
        </div>
        <img
          src={avatarUrl || `https://api.dicebear.com/8.x/personas/svg?seed=${seed}`}
          alt={avatarUrl ? name : ''}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = '0'; }}
        />
      </div>
      {presence && presence !== 'none' && (
        <span style={{
          position: 'absolute', right: -1, bottom: -1, width: dotSize, height: dotSize, borderRadius: '50%',
          background: presence === 'active' ? '#2BAC76' : '#E8A427',
          border: `2px solid ${isDark ? '#1a1b20' : '#fff'}`, boxSizing: 'border-box',
        }} />
      )}
      {profileOpen && typeof document !== 'undefined' && createPortal(
        <div onMouseEnter={keepOpen} onMouseLeave={scheduleClose} role="tooltip" style={{
          position: 'fixed', top: profilePos.top, left: profilePos.left, width: 280, zIndex: 10000,
          background: profileBg, color: profileText, border: `1px solid ${profileLine}`, borderRadius: 16,
          boxShadow: isDark ? '0 18px 44px rgba(0,0,0,0.46)' : '0 16px 38px rgba(15,23,42,0.16)', padding: 14,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 44, height: 44, position: 'relative', flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', background: color }}>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800 }}>{initialsOf(name)}</div>
                <img src={avatarUrl || `https://api.dicebear.com/8.x/personas/svg?seed=${seed}`} alt={avatarUrl ? name : ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.opacity = '0'; }} />
              </div>
              {presence === 'active' && <span style={{ position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: '50%', background: '#2BAC76', border: `2.5px solid ${profileBg}`, boxSizing: 'border-box' }} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.2, fontWeight: 800 }}>{name}</p>
                {linkedinUrl && <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name}'s LinkedIn profile`} title="View LinkedIn profile" style={{ width: 16, height: 16, display: 'inline-flex', flexShrink: 0, color: '#0A66C2', textDecoration: 'none' }}><LinkedInIcon style={{ width: 16, height: 16 }} /></a>}
              </div>
              {title && <p style={{ margin: '3px 0 0', fontSize: 12, color: profileMuted, lineHeight: 1.3 }}>{title}</p>}
              {company && <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Building2 aria-hidden="true" style={{ width: 14, height: 14, color: isDark ? '#949ba7' : '#7a8695', flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: isDark ? '#b7bdc7' : '#667085', fontWeight: 650 }}>{company}</span>
              </div>}
            </div>
          </div>
          {bio && <p style={{ margin: '13px 0 0', fontSize: 12.5, lineHeight: 1.5, color: isDark ? '#c7cbd3' : '#465366' }}>{bio}</p>}
          {!!expertise?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>{expertise.slice(0, 4).map(item => <span key={item} style={{ padding: '4px 8px', borderRadius: 999, background: isDark ? 'rgba(54,211,153,0.12)' : '#eef9f4', color: isDark ? '#75d9ae' : '#147554', fontSize: 10.5, fontWeight: 700 }}>{item}</span>)}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function MeAvatar({ name, size, isDark }: { name: string; size: number; isDark: boolean }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: isDark ? 'rgba(255,255,255,0.12)' : '#e8f0fe',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(9, Math.floor(size * 0.3)), fontWeight: 700,
      color: isDark ? '#ddd' : '#1a73e8', letterSpacing: 0.5,
    }}>
      {initialsOf(name || 'Me')}
    </div>
  );
}

export function TypingDots({ isDark }: { isDark: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} className="animate-bounce motion-reduce:animate-none" style={{
          width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
          background: isDark ? '#888' : '#aaa', animationDelay: `${i * 160}ms`,
        }} />
      ))}
    </span>
  );
}

// Attachment card with a file-type icon: reads like a real mail attachment.
export function AttachmentCard({ name, isDark, href, onClick, subtitle }: {
  name: string; isDark: boolean; href?: string; onClick?: () => void; subtitle?: string;
}) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const kind = ['csv', 'xlsx', 'xls'].includes(ext) ? 'sheet'
    : ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext) ? 'doc'
    : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) ? 'image'
    : ['py', 'sql', 'js', 'ts', 'json', 'ipynb'].includes(ext) ? 'code'
    : 'file';
  const iconColor = kind === 'sheet' ? '#1D8A4E' : kind === 'doc' ? '#D93025' : kind === 'image' ? '#1A73E8' : kind === 'code' ? '#E8710A' : (isDark ? '#aaa' : '#5f6368');
  const Icon = kind === 'sheet' ? FileSpreadsheet : kind === 'doc' ? FileText : kind === 'image' ? FileImage : kind === 'code' ? FileCode2 : FileIcon;
  const inner = (
    <>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${iconColor}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon style={{ width: 17, height: 17, color: iconColor }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: isDark ? '#e8eaed' : '#202124', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{name}</p>
        <p style={{ margin: 0, fontSize: 11, color: isDark ? '#888' : '#80868b' }}>{subtitle || fileSizeFor(name)}</p>
      </div>
    </>
  );
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px', borderRadius: 12,
    background: isDark ? 'rgba(255,255,255,0.04)' : '#fff',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#dadce0'}`,
    textDecoration: 'none', cursor: (href || onClick) ? 'pointer' : 'default',
  };
  if (href) return <a href={href} target="_blank" rel="noreferrer" style={style}>{inner}</a>;
  return <button onClick={onClick} style={{ ...style, textAlign: 'left', font: 'inherit' }}>{inner}</button>;
}

// Simple pill chip (labels like "Inbox", "Important", tool tags).
export function Chip({ children, isDark, tone = 'neutral' }: {
  children: React.ReactNode; isDark: boolean; tone?: 'neutral' | 'accent' | 'warn';
}) {
  const palette = tone === 'accent'
    ? { bg: 'rgba(26,115,232,0.12)', fg: isDark ? '#8ab4f8' : '#1a67d2' }
    : tone === 'warn'
    ? { bg: 'rgba(217,48,37,0.1)', fg: isDark ? '#f28b82' : '#c5221f' }
    : { bg: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', fg: isDark ? '#bbb' : '#5f6368' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 10, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, background: palette.bg, color: palette.fg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// What surface a requirement renders through, so the "more content ahead"
// indicator can describe it accurately instead of always saying "email".
export function arrivalKindFor(req: { type: string; emailFrame?: boolean }): 'mail' | 'chat' | 'plain' {
  if (req.type === 'briefing' || req.type === 'debrief') return 'mail';
  if (req.type === 'scenario_update' || req.type === 'decision') return 'chat';
  if (req.emailFrame) return 'mail';
  return 'plain';
}

// "N more things ahead" banner shown while sequential arrival is holding
// content back. Wording and avatar adapt to what the next item actually is -
// a plain task/MCQ/upload is not "an email".
export function ArrivalIndicator({ isDark, accent, manager, hiddenCount, nextKind }: {
  isDark: boolean;
  accent: string;
  manager: Person;
  hiddenCount: number;
  nextKind: 'mail' | 'chat' | 'plain';
}) {
  if (hiddenCount <= 0) return null;
  const tFaint = isDark ? '#888' : '#666';
  const noun = nextKind === 'mail' ? (hiddenCount === 1 ? 'email' : 'emails')
    : nextKind === 'chat' ? (hiddenCount === 1 ? 'message' : 'messages')
    : (hiddenCount === 1 ? 'step' : 'steps');
  const preposition = nextKind === 'plain' ? 'ahead' : 'on the way';
  const pronoun = hiddenCount === 1 ? 'it' : 'the next one';
  const verb = nextKind === 'plain' ? 'unlocks' : 'arrives';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {nextKind !== 'plain' && <PersonAvatar {...manager} size={26} presence="active" isDark={isDark} />}
      <span className="animate-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: accent, display: 'inline-block', flexShrink: 0 }} />
      <p style={{ fontSize: 12.5, color: tFaint, margin: 0 }}>
        {hiddenCount} more {noun} {preposition} - {pronoun} {verb} once you finish this
      </p>
    </div>
  );
}

// One-time keyframes for arrival animations; rendering it more than once is harmless.
export function WorkplaceKeyframes() {
  return (
    <style>{`
      @keyframes veMailIn { from { opacity: 0; transform: translateY(10px) scale(0.995); } to { opacity: 1; transform: none; } }
      @keyframes veToastIn { 0% { opacity: 0; transform: translateY(-6px); } 12% { opacity: 1; transform: none; } 82% { opacity: 1; } 100% { opacity: 0; } }
      @keyframes vePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      .ve-mail-in { animation: veMailIn 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
      .ve-toast-in { animation: veToastIn 3.4s ease both; }
      .ve-pulse { animation: vePulse 1.6s ease infinite; }
      @media (prefers-reduced-motion: reduce) {
        .ve-mail-in, .ve-toast-in, .ve-pulse { animation: none; }
      }
    `}</style>
  );
}
