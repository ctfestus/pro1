'use client';

// Simulated team-chat surface (Slack-style) for virtual experiences.
// Presentational only: all interaction logic stays in the calling player.

import React from 'react';
import { CaretDown, Eyes, Fire, Hash, ThumbsUp } from '@phosphor-icons/react';
import { Person, PersonAvatar, MeAvatar, TypingDots, WorkplaceKeyframes, colleaguesFor, slugify, firstArrival, playArrivalChime } from './workplace';

export function channelFor(role?: string, fallback = 'project-war-room'): string {
  const slug = slugify(role || '');
  return slug ? `${slug}-team` : fallback;
}

// The same soft panel and card-coloured messages as the mail surface.
function chatPalette(isDark: boolean) {
  return {
    panel:  isDark ? '#262626' : '#f5f6f8',
    bg:     isDark ? '#1e1e1e' : '#ffffff',
    line:   isDark ? '#363636' : '#e3e6ea',
    text:   isDark ? '#eeeeee' : '#111111',
    muted:  isDark ? '#b4b9c0' : '#555555',
    faint:  isDark ? '#8b929b' : '#8a8f98',
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
      style={{ background: p.panel, borderRadius: 14, padding: 6 }}>
      <WorkplaceKeyframes />

      {/* Workspace and channel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 6px 10px 6px', minWidth: 0 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: '#2BAC76', color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {(company || 'W')[0].toUpperCase()}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: p.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {company || 'Workspace'}
        </span>
        <CaretDown weight="bold" size={12} style={{ color: p.faint, flexShrink: 0 }} aria-hidden />
        <span aria-hidden style={{ width: 1, height: 18, background: p.line, margin: '0 4px', flexShrink: 0 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 13.5, fontWeight: 700, color: p.text, minWidth: 0 }}>
          <Hash weight="bold" size={14} style={{ flexShrink: 0 }} aria-hidden />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel}</span>
        </span>
        {unread && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: p.muted, background: p.bg, padding: '2px 8px', borderRadius: 99, flexShrink: 0 }}>1 new</span>
        )}
        <span style={{ flex: 1 }} />
        {/* Facepile */}
        <span style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden>
          {facepile.map((name, i) => (
            <span key={name} style={{ marginLeft: i === 0 ? 0 : -6, borderRadius: '50%', border: `2px solid ${p.panel}`, display: 'inline-flex' }}>
              <PersonAvatar name={name} size={22} color={['#2BAC76', '#E8912D', '#4A9EDE'][i % 3]} isDark={isDark} />
            </span>
          ))}
        </span>
        <span style={{ fontSize: 12, color: p.muted, marginLeft: 6 }}>{memberCount}</span>
      </div>

      {/* Day divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 10px 4px' }} aria-hidden>
        <span style={{ flex: 1, height: 1, background: p.line }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: p.faint }}>Today</span>
        <span style={{ flex: 1, height: 1, background: p.line }} />
      </div>

      {/* Messages */}
      <div id={`ve-zone-${reqId}`} style={{ marginTop: 6, padding: '14px 18px 16px', background: p.bg, borderRadius: 10 }}>
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
        ? <MeAvatar name={meName || 'Me'} size={36} isDark={isDark} />
        : <PersonAvatar {...(author as Person)} size={36} presence="active" isDark={isDark} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13.5, color: p.text }}>{isMe ? 'You' : (author as Person).name}</span>
          {!isMe && (author as Person).title && (
            <span style={{ alignSelf: 'center', fontSize: 11.5, fontWeight: 600, color: p.muted, background: p.panel, padding: '2px 8px', borderRadius: 99 }}>{(author as Person).title}</span>
          )}
          <span style={{ fontSize: 12, color: p.faint }}>{time}</span>
        </div>
        <div style={{ fontSize: 14.5, color: p.text, marginTop: 4, lineHeight: 1.6 }}>{children}</div>
        {reactions && <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{reactions}</div>}
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

/** A quick reaction under a message: an icon and a word ("Got it"). Active once picked. */
export function ChatReaction({ isDark, accent, icon, label, active, onClick, disabled }: {
  isDark: boolean; accent: string; icon: React.ReactNode; label: string;
  active?: boolean; onClick?: () => void; disabled?: boolean;
}) {
  const p = chatPalette(isDark);
  return (
    <button onClick={onClick} disabled={disabled || !onClick} aria-pressed={active}
      className={onClick && !disabled ? 'transition-opacity hover:opacity-80' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 99, border: 'none',
        background: active ? `${accent}1f` : p.panel,
        fontSize: 12.5, fontWeight: 600,
        color: active ? accent : p.text,
        cursor: onClick && !disabled ? 'pointer' : 'default',
      }}>
      <span style={{ display: 'inline-flex', fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  );
}

/** The quick reactions that acknowledge a chat update, and the reply each one posts in the thread. */
export const ACK_REACTIONS = [
  { label: 'Got it', reply: 'Got it, thanks.', Icon: ThumbsUp },
  { label: 'Seen', reply: 'Seen, thanks.', Icon: Eyes },
  { label: 'On it', reply: 'On it.', Icon: Fire },
] as const;

/** Got it / Seen / On it under an update. Once one is picked, only that one shows, highlighted. */
export function ChatAckReactions({ isDark, accent, picked, onPick }: {
  isDark: boolean; accent: string;
  /** The label picked, once acknowledged. */
  picked?: string;
  /** Leave out in review: the reactions show but cannot be pressed. */
  onPick?: (label: string) => void;
}) {
  const shown = picked ? ACK_REACTIONS.filter(r => r.label === picked).slice(0, 1) : ACK_REACTIONS;
  const list = shown.length ? shown : ACK_REACTIONS.slice(0, 1);
  return (
    <>
      {list.map(r => (
        <ChatReaction key={r.label} isDark={isDark} accent={accent} label={r.label} active={!!picked}
          icon={<r.Icon weight={r.label === 'Got it' ? 'bold' : 'duotone'} />}
          onClick={!picked && onPick ? () => onPick(r.label) : undefined} disabled={!!picked} />
      ))}
    </>
  );
}

/** The thread reply for a picked reaction. */
export const ackReply = (picked?: string) => ACK_REACTIONS.find(r => r.label === picked)?.reply ?? ACK_REACTIONS[0].reply;

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
