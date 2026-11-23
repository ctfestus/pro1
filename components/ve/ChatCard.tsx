'use client';

// Simulated team-chat surface (Slack-style) for virtual experiences.
// Presentational only: all interaction logic stays in the calling player.

import React from 'react';
import { CaretDown, Star } from '@phosphor-icons/react';
import { Person, PersonAvatar, MeAvatar, TypingDots, WorkplaceKeyframes, colleaguesFor, slugify, firstArrival, playArrivalChime } from './workplace';

export function channelFor(role?: string, fallback = 'project-war-room'): string {
  const slug = slugify(role || '');
  return slug ? `${slug}-team` : fallback;
}

function chatPalette(isDark: boolean) {
  return {
    bg:     isDark ? '#1A1D21' : '#FFFFFF',
    header: isDark ? '#202127' : '#F7F9F8',
    line:   isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)',
    text:   isDark ? '#D1D2D3' : '#1D1C1D',
    muted:  isDark ? '#ABABAD' : '#616061',
    faint:  isDark ? '#7A7D81' : '#9E9EA0',
  };
}

export function ChatCard({ isDark, reqId, company, channel, members, unread = false, muteArrival = false, children }: {
  isDark: boolean;
  reqId: string;
  company?: string;
  channel: string;
  members: Person[];          // manager first; "You" is added implicitly
  unread?: boolean;
  muteArrival?: boolean;
  children: React.ReactNode;
}) {
  const p = chatPalette(isDark);
  const extraNames = colleaguesFor(company || channel, 2);
  const facepile = [...members.map(m => m.name), ...extraNames].slice(0, 3);
  const memberCount = facepile.length + 1; // + you
  const [isNew] = React.useState(() => unread && !muteArrival && firstArrival(`chat-${reqId}`));
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isNew) return;
    try { playArrivalChime(); } catch {}
    const t = setTimeout(() => {
      try { rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [isNew]);

  return (
    <div ref={rootRef} className={isNew ? 've-mail-in' : undefined}
      style={{ border: 'none', background: p.bg, borderRadius: 20, overflow: 'hidden', boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.065)' : '0 10px 30px rgba(15,23,42,0.07)' }}>
      <WorkplaceKeyframes />

      {/* Workspace strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: p.header, borderBottom: `1px solid ${p.line}` }}>
        <span className="ve-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#2BAC76', flexShrink: 0 }} />
        <span style={{ width: 22, height: 22, borderRadius: 7, background: '#2BAC76', color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {(company || 'W')[0].toUpperCase()}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: p.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {company || 'Workspace'}
        </span>
        <CaretDown weight="bold" size={12} style={{ color: p.faint, flexShrink: 0 }} aria-hidden />
        <span style={{ flex: 1 }} />

      </div>

      {/* Channel header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 16px', borderBottom: `1px solid ${p.line}` }}>
        <span style={{ fontSize: 16, fontWeight: 900, color: p.muted, lineHeight: 1 }}>#</span>
        <span style={{ fontSize: 14, fontWeight: 750, color: p.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel}</span>
        <Star weight="duotone" size={12} style={{ color: p.faint, flexShrink: 0 }} aria-hidden />
        {unread && (
          <span style={{ marginLeft: 2, background: '#CD2553', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px', lineHeight: '15px', flexShrink: 0 }}>1</span>
        )}
        <span style={{ flex: 1 }} />
        {/* Facepile */}
        <span style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden>
          {facepile.map((name, i) => (
            <span key={name} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: '50%', border: `2px solid ${p.bg}`, display: 'inline-flex' }}>
              <PersonAvatar name={name} size={20} color={['#2BAC76', '#E8912D', '#4A9EDE'][i % 3]} isDark={isDark} />
            </span>
          ))}
        </span>
        <span style={{ fontSize: 12.5, color: p.muted, marginLeft: 6 }}>{memberCount}</span>
      </div>

      {/* Day divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 2px' }} aria-hidden>
        <span style={{ flex: 1, height: 1, background: p.line }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: p.muted, border: `1px solid ${p.line}`, borderRadius: 20, padding: '2px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Today <CaretDown weight="bold" size={10} />
        </span>
        <span style={{ flex: 1, height: 1, background: p.line }} />
      </div>

      {/* Messages */}
      <div id={`ve-zone-${reqId}`} style={{ padding: '10px 14px 12px' }}>
        {children}
      </div>

    </div>
  );
}

export function ChatMsg({ isDark, author, meName, time, children, reactions }: {
  isDark: boolean;
  author: Person | 'me';
  meName?: string;
  time: string;
  children: React.ReactNode;
  reactions?: React.ReactNode;
}) {
  const p = chatPalette(isDark);
  const isMe = author === 'me';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 0' }}>
      {isMe
        ? <MeAvatar name={meName || 'Me'} size={30} isDark={isDark} />
        : <PersonAvatar {...(author as Person)} size={30} presence="active" isDark={isDark} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: p.text }}>{isMe ? 'You' : (author as Person).name}</span>
          <span style={{ fontSize: 12.5, color: p.muted }}>{time}</span>
        </div>
        <div style={{ fontSize: 14.5, color: p.text, marginTop: 2, lineHeight: 1.5 }}>{children}</div>
        {reactions && <div style={{ marginTop: 6 }}>{reactions}</div>}
      </div>
    </div>
  );
}

export function ChatTypingMsg({ isDark, author, meName }: {
  isDark: boolean; author: Person | 'me'; meName?: string;
}) {
  const p = chatPalette(isDark);
  const isMe = author === 'me';
  // Typing rows only mount right after a student action: keep them in view.
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    try { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
  }, []);
  return (
    <div ref={ref} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 0' }}>
      {isMe
        ? <MeAvatar name={meName || 'Me'} size={30} isDark={isDark} />
        : <PersonAvatar {...(author as Person)} size={30} presence="active" isDark={isDark} />}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: p.text }}>{isMe ? 'You' : (author as Person).name}</span>
          <span style={{ fontSize: 12.5, color: p.muted }}>is typing</span>
        </div>
        <div style={{ marginTop: 6 }}><TypingDots isDark={isDark} /></div>
      </div>
    </div>
  );
}

export function ChatReaction({ isDark, accent, emoji, count, active, onClick, disabled }: {
  isDark: boolean; accent: string; emoji: React.ReactNode; count?: number;
  active?: boolean; onClick?: () => void; disabled?: boolean;
}) {
  const p = chatPalette(isDark);
  return (
    <button onClick={onClick} disabled={disabled || !onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px', borderRadius: 14,
        border: `1px solid ${active ? `${accent}70` : p.line}`,
        background: active ? `${accent}14` : 'transparent',
        fontSize: 12.5, fontWeight: active ? 700 : 500,
        color: active ? accent : p.muted,
        cursor: onClick && !disabled ? 'pointer' : 'default',
      }}>
      <span style={{ fontSize: 14 }}>{emoji}</span>
      {count !== undefined ? count : 'React'}
    </button>
  );
}

// Thread block: indent + "N replies" label above the replies.
export function ChatThread({ isDark, label, children }: { isDark: boolean; label: string; children: React.ReactNode }) {
  const p = chatPalette(isDark);
  return (
    <div style={{ borderTop: `1px solid ${p.line}`, marginTop: 10, paddingTop: 10 }}>
      <p style={{ fontSize: 12.5, color: p.muted, fontWeight: 600, margin: '0 0 8px', paddingLeft: 40 }}>{label}</p>
      <div style={{ paddingLeft: 10, borderLeft: `2px solid ${p.line}`, marginLeft: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

// Block-kit style decision buttons.

// Block-kit style decision buttons.
export function ChatDecisionButtons({ isDark, accent, options, onPick, disabled }: {
  isDark: boolean; accent: string; options: string[]; onPick: (opt: string) => void; disabled?: boolean;
}) {
  const p = chatPalette(isDark);
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
      {options.map((opt, oi) => {
        const letter = String.fromCharCode(65 + oi);
        return (
          <button key={oi} onClick={() => onPick(opt)} disabled={disabled}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 8,
              border: `1px solid ${p.line}`, background: isDark ? 'rgba(255,255,255,0.02)' : '#fff',
              textAlign: 'left', cursor: disabled ? 'default' : 'pointer', fontSize: 13.5, color: p.text,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = `${accent}08`; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = p.line; e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.02)' : '#fff'; }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${p.faint}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: p.muted, flexShrink: 0, marginTop: 1 }}>{letter}</span>
            <span style={{ flex: 1, lineHeight: 1.45 }}>{opt}</span>
          </button>
        );
      })}
    </div>
  );
}
