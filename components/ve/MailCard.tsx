'use client';

// Simulated email-client surface for virtual experiences. Renders a realistic
// mail window (app bar, toolbar, headers, body, attachments, thread, composer)
// while all interaction logic stays in the calling player.
//
// Any HTML passed in (bodyHtml, thread children built from rich text) must be
// sanitized by the caller before it gets here.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowBendUpLeft, CaretDown, ChatTeardropDots, Checks, Clock, ListBullets, ListNumbers, PaperPlaneRight, Paperclip, ShieldCheck, Smiley, TextB, TextItalic, TextUnderline, Trash, Tray } from '@phosphor-icons/react';
import {
  Person, PersonAvatar, MeAvatar, AttachmentCard, Chip, TypingDots,
  WorkplaceKeyframes, firstArrival, playArrivalChime, firstNameOf,
} from './workplace';

// -- rich text compose box (moved out of the players) --------------------------

export function RichTextArea({
  value, onChange, readOnly, isDark, placeholder, noBorder = false, minHeight = 120,
}: {
  value: string; onChange: (html: string) => void; readOnly: boolean;
  isDark: boolean; placeholder: string; noBorder?: boolean; minHeight?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(() => !value?.replace(/<[^>]*>/g, '').trim());
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !value) return;
    el.innerHTML = value;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const exec = (cmd: string) => {
    document.execCommand(cmd, false, undefined);
    const el = editorRef.current;
    if (el) { el.focus(); onChange(el.innerHTML); setIsEmpty(!el.innerText?.trim()); }
  };
  const bd = isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1';
  const tc = isDark ? '#f0f0f0' : '#111';
  const mc = isDark ? '#777' : '#bbb';
  const tb: React.CSSProperties = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', borderRadius: 4, cursor: 'pointer', color: tc, fontSize: 13 };
  return (
    <div className={noBorder ? undefined : 'focus-frame'} style={noBorder ? { background: isDark ? 'rgba(255,255,255,0.02)' : '#fff' } : { border: `1.5px solid ${bd}`, borderRadius: 10, overflow: 'hidden', background: isDark ? 'rgba(255,255,255,0.055)' : '#fff', boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)' }}>
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 10px', background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', borderBottom: `1px solid ${bd}` }}>
          <button onClick={() => exec('bold')} style={tb} title="Bold"><TextB weight="bold" size={14} /></button>
          <button onClick={() => exec('italic')} style={tb} title="Italic"><TextItalic weight="bold" size={14} /></button>
          <button onClick={() => exec('underline')} style={tb} title="Underline"><TextUnderline weight="bold" size={14} /></button>
          <span style={{ width: 1, height: 16, background: bd, margin: '0 4px', flexShrink: 0 }} />
          <button onClick={() => exec('insertUnorderedList')} style={tb} title="Bullet list"><ListBullets weight="bold" size={14} /></button>
          <button onClick={() => exec('insertOrderedList')} style={tb} title="Numbered list"><ListNumbers weight="bold" size={14} /></button>
        </div>
      )}
      <div style={{ position: 'relative', minHeight }}>
        {isEmpty && !readOnly && (
          <div style={{ position: 'absolute', top: 14, left: 16, fontSize: 14, color: mc, pointerEvents: 'none', lineHeight: 1.7 }}>{placeholder}</div>
        )}
        <div
          ref={editorRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onInput={() => { const el = editorRef.current; if (!el) return; onChange(el.innerHTML); setIsEmpty(!el.innerText?.trim()); }}
          style={{ minHeight, padding: '14px 16px', fontSize: 14, lineHeight: 1.7, color: tc, background: 'transparent', outline: 'none', wordBreak: 'break-word' }}
        />
      </div>
    </div>
  );
}

// -- mail window ----------------------------------------------------------------

export interface MailAttachment { name: string; url?: string; onClick?: () => void; subtitle?: string }

/** The mail surface colours: a soft panel, with each message on the card colour. */
export function mailTones(isDark: boolean) {
  return {
    panel: isDark ? '#262626' : '#f5f6f8',
    block: isDark ? '#1e1e1e' : '#ffffff',
    line:  isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    text:  isDark ? '#eeeeee' : '#111111',
    muted: isDark ? '#b4b9c0' : '#555555',
    faint: isDark ? '#8b929b' : '#8a8f98',
  };
}

/** "Reply to Kofi": heads whatever the learner answers an email with. */
export function ReplyHeading({ isDark, to }: { isDark: boolean; to: string }) {
  const m = mailTones(isDark);
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 12px', fontSize: 12.5, fontWeight: 700, color: m.muted }}>
      <ArrowBendUpLeft weight="bold" size={13} aria-hidden /> Reply to {firstNameOf(to) || to}
    </p>
  );
}

/** The sender's sign-off: name, then role and company, set off by a line on the left. */
export function MailSignature({ isDark, sender, company }: { isDark: boolean; sender: Person; company?: string }) {
  const m = mailTones(isDark);
  const role = [sender.title, company].filter(Boolean).join(', ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12, borderLeft: `2px solid ${isDark ? '#363636' : '#e3e6ea'}`, fontSize: 13, lineHeight: 1.5 }}>
      <b style={{ fontWeight: 700, color: m.text }}>{sender.name}</b>
      {role && <span style={{ color: m.faint }}>{role}</span>}
    </div>
  );
}

/** One message in the mail panel, on the card colour. */
export function MailBlock({ isDark, children, style }: { isDark: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: mailTones(isDark).block, borderRadius: 10, padding: '16px 22px 20px', ...style }}>{children}</div>;
}

export function MailCard({
  isDark, accent, reqId, subject, sender, toName, toEmail, stamp, bodyHtml,
  attachments, company, done = false, muteArrival = false, signature = true, signatureAfterChildren = false, chatAction,
  collapsed = false, ownBlocks = false, children,
}: {
  isDark: boolean;
  accent: string;
  reqId: string;
  subject: string;
  sender: Person;
  // The learner's name and address. Not shown: the mail reads "to me", as a real inbox does.
  toName: string;
  toEmail: string;
  stamp: { day: string; time: string; full: string };
  bodyHtml?: string;         // sanitized by the caller
  attachments?: MailAttachment[];
  company?: string;
  done?: boolean;
  muteArrival?: boolean;     // review/preview: no chime, no arrival animation
  signature?: boolean;
  /** Assessment emails keep upload/review controls inside the message, before the sign-off. */
  signatureAfterChildren?: boolean;
  // Optional chat launcher in the header (e.g. "Chat with Sarah").
  // attention pulses its dot until the chat has been opened once.
  chatAction?: { label: string; onClick: () => void; attention?: boolean };
  /** The email folds to one line (sender and subject) once the thread below it has moved on. */
  collapsed?: boolean;
  /** The children are already split into MailBlocks, one per message, instead of sharing one. */
  ownBlocks?: boolean;
  children?: React.ReactNode;
}) {
  const [read, setRead] = useState(done);
  const [isNew] = useState(() => !done && !muteArrival && firstArrival(reqId));
  const [expanded, setExpanded] = useState(false);
  const folded = collapsed && !expanded;
  // The details pop-up under "to me" (from, to, date, subject), as in Gmail: it floats over the
  // email instead of pushing it down, and closes on a click elsewhere, Escape, or a scroll.
  // Holds where to place it (below the "to me" button) while open.
  const [detailsAt, setDetailsAt] = useState<{ left: number; top: number; width: number } | null>(null);
  const showDetails = detailsAt !== null;
  const detailsBtnRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDListElement>(null);
  useEffect(() => {
    if (!showDetails) return;
    const close = () => setDetailsAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (detailsRef.current?.contains(target) || detailsBtnRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); detailsBtnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    // Capture: the email sits inside a scrolling pane, and its scroll does not bubble.
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [showDetails]);
  const toggleDetails = () => {
    if (showDetails) { setDetailsAt(null); return; }
    const r = detailsBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(420, window.innerWidth - 24);
    setDetailsAt({ left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)), top: r.bottom + 4, width });
  };
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isNew) return;
    try { playArrivalChime(); } catch {}
    // A message that just "arrived" announces itself: slide in, then come into view.
    const t = setTimeout(() => {
      try { rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [isNew]);

  const m = mailTones(isDark);
  const unread = !read && !done;
  const role = [sender.title, company].filter(Boolean).join(', ');
  const roleTag = role && (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: m.muted, background: m.panel, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{role}</span>
  );
  const sign = signature && (sender.title || company) ? <MailSignature isDark={isDark} sender={sender} company={company} /> : null;

  return (
    <div ref={rootRef} className={isNew ? 've-mail-in' : undefined}
      onClick={() => { if (unread) setRead(true); }}
      style={{ position: 'relative', background: m.panel, borderRadius: 14, padding: 6 }}>
      <WorkplaceKeyframes />

      {/* App bar: the inbox, how many are new, and the chat launcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 6px 10px 6px' }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: m.block, display: 'grid', placeItems: 'center', color: m.text, flexShrink: 0 }}>
          <Tray weight="duotone" size={16} aria-hidden />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: m.text }}>Inbox</span>
        {unread && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: m.muted, background: m.block, padding: '2px 8px', borderRadius: 99 }}>1 new</span>
        )}
        <span style={{ flex: 1 }} />
        {chatAction && (
          <button onClick={chatAction.onClick} title={chatAction.label}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, border: 'none', background: m.block, color: m.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <ChatTeardropDots weight="bold" size={13} aria-hidden />
            {chatAction.label}
            <span className={chatAction.attention ? 've-pulse' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: accent }} />
          </button>
        )}
      </div>

      {/* New-mail toast */}
      {isNew && (
        <div className="ve-toast-in" style={{ position: 'absolute', top: 50, right: 12, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, background: isDark ? '#2a2b31' : '#202124', color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
          <span className="ve-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
          New message from {firstNameOf(sender.name)}
        </div>
      )}

      {folded ? (
        // The email, folded to one line: who sent it and what about. Opens again on a click.
        <button type="button" onClick={() => setExpanded(true)} aria-expanded={false}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderRadius: 10, border: 'none', background: m.block, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
          <PersonAvatar {...sender} size={32} presence="active" isDark={isDark} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <b style={{ fontSize: 13.5, fontWeight: 700, color: m.text }}>{sender.name}</b>{roleTag}
            </span>
            <span style={{ display: 'block', fontSize: 12.5, color: m.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subject}</span>
          </span>
          <span style={{ fontSize: 12.5, color: m.faint, whiteSpace: 'nowrap' }}>{stamp.full}</span>
        </button>
      ) : (
      <div style={{ background: m.block, borderRadius: 10, padding: '20px 22px' }}>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: m.text, lineHeight: 1.35, margin: '0 0 16px' }}>{subject}</h3>

        {/* Sender: name and role, then "to me" with its details pop-up; the time on the right. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <PersonAvatar {...sender} size={40} presence="active" isDark={isDark} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', columnGap: 8, rowGap: 2, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: m.text }}>{sender.name}</span>
              {roleTag}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: m.faint, whiteSpace: 'nowrap' }}>
                <Clock weight="bold" size={12} aria-hidden /> {stamp.full}
              </span>
            </div>
            <button ref={detailsBtnRef} type="button" onClick={e => { e.stopPropagation(); toggleDetails(); }} aria-expanded={showDetails} aria-haspopup="dialog"
              aria-label={showDetails ? 'Hide details' : 'Show details'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, margin: '2px 0 0', padding: '2px 4px 2px 0', background: 'none', border: 'none', font: 'inherit', fontSize: 12.5, color: m.faint, cursor: 'pointer' }}>
              to me <CaretDown weight="bold" size={12} />
            </button>
            {detailsAt && createPortal(
              <dl ref={detailsRef} role="dialog" aria-label="Message details"
                style={{ position: 'fixed', left: detailsAt.left, top: detailsAt.top, width: detailsAt.width, zIndex: 1000, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 12, rowGap: 5, margin: 0, padding: '12px 14px', borderRadius: 12, background: isDark ? '#2a2b31' : '#ffffff', boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.08), 0 12px 32px rgba(0,0,0,0.5)' : '0 0 0 1px rgba(15,23,42,0.06), 0 12px 32px rgba(15,23,42,0.16)', fontSize: 12.5, lineHeight: 1.5 }}>
                <dt style={{ color: m.faint }}>from:</dt>
                <dd style={{ margin: 0, color: m.text, overflowWrap: 'anywhere' }}><b style={{ fontWeight: 600 }}>{sender.name}</b>{sender.email ? ` (${sender.email})` : ''}</dd>
                <dt style={{ color: m.faint }}>to:</dt>
                <dd style={{ margin: 0, color: m.text, overflowWrap: 'anywhere' }}><b style={{ fontWeight: 600 }}>{toName || 'me'}</b>{toEmail ? ` (${toEmail})` : ''}</dd>
                <dt style={{ color: m.faint }}>date:</dt>
                <dd style={{ margin: 0, color: m.text }}>{stamp.full}</dd>
                <dt style={{ color: m.faint }}>subject:</dt>
                <dd style={{ margin: 0, color: m.text, overflowWrap: 'anywhere' }}>{subject}</dd>
              </dl>,
              document.body,
            )}
          </div>
        </div>

        {bodyHtml && (
          <div
            className="rich-content"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
            style={{ marginTop: 14, color: isDark ? '#e0e0e0' : '#1f1f1f', fontSize: 15, lineHeight: 1.65 }}
          />
        )}

        {sign && !signatureAfterChildren && <div style={{ marginTop: 12 }}>{sign}</div>}

        {/* Attachments */}
        {!!attachments?.length && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Paperclip weight="bold" size={12} style={{ color: m.faint }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: m.muted }}>
                {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}
              </span>
              <ShieldCheck weight="duotone" size={12} style={{ color: '#2BAC76' }} />
              <span style={{ fontSize: 12, color: m.faint }}>Scanned{company ? ` by ${company} Mail` : ''}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {attachments.map((att, i) => (
                <AttachmentCard key={i} name={att.name} isDark={isDark} href={att.url} onClick={att.onClick} subtitle={att.subtitle} />
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Interaction area (thread, suggested replies, composer...) */}
      {children != null && (
        <div id={`ve-zone-${reqId}`} style={ownBlocks
          ? { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }
          : { marginTop: 6, background: m.block, borderRadius: 10 }}>
          {children}
          {sign && signatureAfterChildren && <div style={{ padding: '0 22px 18px' }}>{sign}</div>}
        </div>
      )}
    </div>
  );
}

// -- conversation pieces ----------------------------------------------------------

export function MailThreadMsg({ isDark, from, meName, time = 'Just now', receipt, quote, children }: {
  isDark: boolean;
  from: Person | 'me';
  meName?: string;
  time?: string;
  receipt?: string;          // e.g. "Seen by Sarah just now"
  quote?: string;            // quoted original, e.g. "On Tue 9:10 AM, Sarah Chen wrote: ..."
  children: React.ReactNode;
}) {
  const tText  = isDark ? '#e8eaed' : '#202124';
  const tFaint = isDark ? '#6b7075' : '#9aa0a6';
  const isMe = from === 'me';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      {isMe
        ? <MeAvatar name={meName || 'Me'} size={38} isDark={isDark} />
        : <PersonAvatar {...(from as Person)} size={38} presence="active" isDark={isDark} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: tText }}>{isMe ? 'Me' : (from as Person).name}</span>
          <span style={{ fontSize: 12.5, color: tFaint }}>{time}</span>
        </div>
        <div style={{ fontSize: 14.5, color: isDark ? '#e0e0e0' : '#1f1f1f', lineHeight: 1.65 }}>{children}</div>
        {quote && (
          <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`, fontSize: 12.5, color: tFaint, lineHeight: 1.5 }}>
            {quote}
          </div>
        )}
        {receipt && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '6px 0 0', fontSize: 12, color: tFaint }}>
            <Checks weight="bold" size={12} style={{ color: '#1a73e8' }} /> {receipt}
          </p>
        )}
      </div>
    </div>
  );
}

export function MailTypingRow({ isDark, person }: { isDark: boolean; person: Person }) {
  // Typing rows only ever mount right after a student action, so pulling
  // themselves into view keeps the eye on the conversation.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
  }, []);
  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <PersonAvatar {...person} size={38} presence="active" isDark={isDark} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 18, background: isDark ? '#2a2b31' : '#f1f3f4' }}>
        <TypingDots isDark={isDark} />
      </div>
    </div>
  );
}

// Gmail-style suggested replies, under a "Reply to" heading.
export function SmartReplies({ isDark, accent, options, onPick, to }: {
  isDark: boolean; accent: string; options: string[]; onPick: (text: string) => void; to: string;
}) {
  const m = mailTones(isDark);
  return (
    <div>
      <ReplyHeading isDark={isDark} to={to} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt, i) => (
          <button key={i} onClick={() => onPick(opt)}
            className="transition-opacity hover:opacity-80"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 99, fontSize: 13.5, fontWeight: 600, border: 'none', color: m.text, background: m.panel, cursor: 'pointer' }}>
            {opt}
            <PaperPlaneRight weight="fill" size={13} style={{ color: accent }} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

// Reply composer: To/Subject header + rich text + send bar.
export function MailComposer({
  isDark, accent, to, subject, value, onChange, onSend, onDiscard, canSend,
  sending = false, sendLabel = 'Send', placeholder = 'Write your reply...', extra, maxChars,
}: {
  isDark: boolean;
  accent: string;
  to: Person;
  subject: string;
  value: string;
  onChange: (html: string) => void;
  onSend: () => void;
  onDiscard?: () => void;
  canSend: boolean;
  sending?: boolean;
  sendLabel?: string;
  placeholder?: string;
  extra?: React.ReactNode;   // e.g. attach controls rendered above the send bar
  maxChars?: number;         // opt-in char cap on the stripped text (e.g. AI-review answers)
}) {
  const line   = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tMuted = isDark ? '#9aa0a6' : '#5f6368';
  const tFaint = isDark ? '#6b7075' : '#9aa0a6';
  // Count the stripped text the same way the server does, so the counter matches the real limit.
  const plainLen = maxChars != null ? value.replace(/<[^>]*>/g, '').trim().length : 0;
  const overLimit = maxChars != null && plainLen > maxChars;
  const sendable = canSend && !sending && !overLimit;
  return (
    <div className="focus-frame" style={{ border: `1px solid ${line}`, borderRadius: 12, overflow: 'hidden', background: isDark ? '#1e1f24' : '#fff', boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.06)', ['--focus-frame' as string]: accent, ['--focus-frame-ring' as string]: `${accent}29` }}>
      {/* To / Subject headers */}
      <div style={{ padding: '10px 14px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: `1px solid ${line}` }}>
          <ArrowBendUpLeft weight="bold" size={13} style={{ color: tFaint, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: tMuted }}>To:</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px 2px 3px', borderRadius: 14, background: isDark ? 'rgba(255,255,255,0.07)' : '#f1f3f4' }}>
            <PersonAvatar {...to} size={18} isDark={isDark} />
            <span style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e8eaed' : '#202124' }}>{to.name}</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${line}` }}>
          <span style={{ fontSize: 13, color: tMuted, flexShrink: 0 }}>Subject:</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e8eaed' : '#202124', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subject.startsWith('Re:') ? subject : `Re: ${subject}`}
          </span>
        </div>
      </div>
      <RichTextArea value={value} onChange={onChange} readOnly={false} isDark={isDark} placeholder={placeholder} noBorder />
      {extra && <div style={{ padding: '0 14px 10px' }}>{extra}</div>}
      {/* Send bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: `1px solid ${line}` }}>
        <button onClick={onSend} disabled={!sendable}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 22px', borderRadius: 18,
            background: sendable ? accent : (isDark ? '#333' : '#e0e0e0'),
            color: sendable ? '#fff' : (isDark ? '#666' : '#aaa'),
            fontSize: 13.5, fontWeight: 700, border: 'none',
            cursor: sendable ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
          }}>
          <PaperPlaneRight weight="duotone" size={14} /> {sending ? 'Sending...' : sendLabel}
        </button>
        <Paperclip weight="bold" size={15} style={{ color: tFaint }} aria-hidden />
        <Smiley weight="duotone" size={15} style={{ color: tFaint }} aria-hidden />
        <span style={{ flex: 1 }} />
        {maxChars != null && (
          <span style={{ fontSize: 12, fontWeight: 600, color: overLimit ? '#ef4444' : plainLen >= maxChars * 0.96 ? '#ef4444' : tFaint }}>
            {plainLen} / {maxChars}
          </span>
        )}
        {onDiscard && (
          <button onClick={onDiscard} title="Discard draft"
            style={{ border: 'none', background: 'transparent', color: tFaint, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Trash weight="duotone" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// Small status chip shown once an action lands ("Reply sent", "Brief acknowledged").
export function MailStatusChip({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: `${accent}12`, color: accent, border: `1px solid ${accent}30`, fontSize: 12.5, fontWeight: 600 }}>
      <Checks weight="bold" size={14} /> {children}
    </div>
  );
}
