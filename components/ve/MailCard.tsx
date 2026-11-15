'use client';

// Simulated email-client surface for virtual experiences. Renders a realistic
// mail window (app bar, toolbar, headers, body, attachments, thread, composer)
// while all interaction logic stays in the calling player.
//
// Any HTML passed in (bodyHtml, thread children built from rich text) must be
// sanitized by the caller before it gets here.

import React, { useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveX, Trash2, MailOpen, MoreVertical, Star, Reply, Search,
  Settings, ChevronLeft, Printer, CornerUpLeft, Paperclip, Smile, Send,
  Bold, Italic, Underline, List, ListOrdered, CheckCheck, ShieldCheck, Inbox,
  MessageSquare,
} from 'lucide-react';
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
          <button onClick={() => exec('bold')} style={tb} title="Bold"><Bold size={14} /></button>
          <button onClick={() => exec('italic')} style={tb} title="Italic"><Italic size={14} /></button>
          <button onClick={() => exec('underline')} style={tb} title="Underline"><Underline size={14} /></button>
          <span style={{ width: 1, height: 16, background: bd, margin: '0 4px', flexShrink: 0 }} />
          <button onClick={() => exec('insertUnorderedList')} style={tb} title="Bullet list"><List size={14} /></button>
          <button onClick={() => exec('insertOrderedList')} style={tb} title="Numbered list"><ListOrdered size={14} /></button>
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

export function MailCard({
  isDark, accent, reqId, subject, sender, stamp, bodyHtml,
  attachments, company, done = false, muteArrival = false, signature = true, signatureAfterChildren = false, chatAction, children,
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
  // Optional chat launcher in the action toolbar (e.g. "Chat with Sarah").
  // attention shows a pulsing dot until the chat has been opened once.
  chatAction?: { label: string; onClick: () => void; attention?: boolean };
  children?: React.ReactNode;
}) {
  const [read, setRead] = useState(done);
  const [isNew] = useState(() => !done && !muteArrival && firstArrival(reqId));
  const [showSenderEmail, setShowSenderEmail] = useState(false);
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

  const winBg   = isDark ? '#1b1c20' : '#ffffff';
  const barBg   = isDark ? '#202127' : '#f7f9f8';
  const line    = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const tText   = isDark ? '#e8eaed' : '#202124';
  const tMuted  = isDark ? '#9aa0a6' : '#5f6368';
  const tFaint  = isDark ? '#6b7075' : '#9aa0a6';
  const iconBtn: React.CSSProperties = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: 'none', background: 'transparent', color: tMuted, opacity: 0.75, cursor: 'default' };
  const unread = !read && !done;

  return (
    <div ref={rootRef} className={isNew ? 've-mail-in' : undefined}
      onClick={() => { if (unread) setRead(true); }}
      style={{ position: 'relative', background: winBg, border: 'none', borderRadius: 20, overflow: 'hidden', boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.065)' : '0 10px 30px rgba(15,23,42,0.07)' }}>
      <WorkplaceKeyframes />

      {/* App bar: mail identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: barBg, borderBottom: `1px solid ${line}` }}>
        <span className="ve-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <Inbox style={{ width: 15, height: 15, color: tMuted, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 750, color: tText }}>Work inbox</span>
        {unread && (
          <span style={{ marginLeft: 4, minWidth: 16, height: 16, borderRadius: 8, background: '#D93025', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>1</span>
        )}
        <span style={{ flex: 1 }} />
        <Search style={{ width: 14, height: 14, color: tFaint }} aria-hidden />
        <Settings style={{ width: 14, height: 14, color: tFaint }} aria-hidden />
      </div>

      {/* Action toolbar (decorative except the chat launcher: sells the client) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 10px', borderBottom: `1px solid ${line}` }}>
        <span aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={iconBtn}><ChevronLeft size={16} /></span>
          <span style={{ width: 1, height: 14, background: line, margin: '0 4px' }} />
          <span style={iconBtn}><Archive size={14} /></span>
          <span style={iconBtn}><ArchiveX size={14} /></span>
          <span style={iconBtn}><Trash2 size={14} /></span>
          <span style={{ width: 1, height: 14, background: line, margin: '0 4px' }} />
          <span style={iconBtn}><MailOpen size={14} /></span>
          <span style={iconBtn}><Printer size={14} /></span>
        </span>
        {chatAction && (
          <>
            <span aria-hidden style={{ width: 1, height: 14, background: line, margin: '0 4px' }} />
            <button onClick={chatAction.onClick} title={chatAction.label}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 14, border: `1px solid ${accent}45`, background: `${accent}16`, color: accent, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <MessageSquare size={13} />
              {chatAction.label}
              {chatAction.attention && (
                <span className="ve-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: accent }} />
              )}
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <span aria-hidden style={iconBtn}><MoreVertical size={14} /></span>
      </div>

      {/* New-mail toast */}
      {isNew && (
        <div className="ve-toast-in" style={{ position: 'absolute', top: 44, right: 12, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, background: isDark ? '#2a2b31' : '#202124', color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
          <span className="ve-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
          New message from {firstNameOf(sender.name)}
        </div>
      )}

      {/* Subject */}
      <div style={{ padding: '20px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {unread && <span title="Unread" style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a73e8', marginTop: 9, flexShrink: 0 }} />}
        <h3 style={{ fontSize: 18, fontWeight: 750, color: tText, lineHeight: 1.35, margin: 0, flex: 1, minWidth: 0 }}>{subject}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 2 }}>
          <Chip isDark={isDark}>Inbox</Chip>
          <Star size={16} style={{ color: done ? '#f4b400' : tFaint }} fill={done ? '#f4b400' : 'none'} aria-hidden />
        </div>
      </div>

      {/* Sender row */}
      <div style={{ padding: '14px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <PersonAvatar {...sender} size={42} presence="active" isDark={isDark} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            {/* The address stays out of the way: it shows on hover, and a tap on the name reveals it. */}
            <button type="button" onClick={() => setShowSenderEmail(v => !v)} title={sender.email || undefined}
              aria-expanded={sender.email ? showSenderEmail : undefined}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 14, fontWeight: 700, color: tText, cursor: sender.email ? 'pointer' : 'default' }}>
              {sender.name}
            </button>
            {sender.email && showSenderEmail && <span style={{ fontSize: 12, color: tFaint }}>{sender.email}</span>}
          </div>
          <p style={{ fontSize: 12, color: tFaint, margin: '2px 0 0' }}>to me</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: tMuted, whiteSpace: 'nowrap' }}>{stamp.full}</span>
          <Reply size={14} style={{ color: tFaint }} aria-hidden />
        </div>
      </div>

      {/* Body */}
      {bodyHtml && (
        <div
          className="rich-content"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
          style={{ padding: '16px 22px 4px', color: isDark ? '#e0e0e0' : '#1f1f1f', fontSize: 14.5, lineHeight: 1.75 }}
        />
      )}

      {/* Signature */}
      {signature && !signatureAfterChildren && (sender.title || company) && (
        <div style={{ padding: '10px 22px 4px' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: tMuted, lineHeight: 1.6 }}>
            {sender.name}<br />
            <span style={{ color: tFaint }}>{[sender.title, company].filter(Boolean).join(' | ')}</span>
          </p>
        </div>
      )}

      {/* Attachments */}
      {!!attachments?.length && (
        <div style={{ padding: '14px 22px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Paperclip size={12} style={{ color: tFaint }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: tMuted }}>
              {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}
            </span>
            <ShieldCheck size={12} style={{ color: '#2BAC76' }} />
            <span style={{ fontSize: 11, color: tFaint }}>Scanned{company ? ` by ${company} Mail` : ''}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {attachments.map((att, i) => (
              <AttachmentCard key={i} name={att.name} isDark={isDark} href={att.url} onClick={att.onClick} subtitle={att.subtitle} />
            ))}
          </div>
        </div>
      )}

      {/* Interaction area (thread, smart replies, composer...) */}
      {children != null && (
        <div id={`ve-zone-${reqId}`} style={{ borderTop: `1px solid ${line}`, marginTop: 14 }}>
          {children}
        </div>
      )}
      {signature && signatureAfterChildren && (sender.title || company) && (
        <div style={{ padding: '10px 22px 16px' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: tMuted, lineHeight: 1.6 }}>
            {sender.name}<br />
            <span style={{ color: tFaint }}>{[sender.title, company].filter(Boolean).join(' | ')}</span>
          </p>
        </div>
      )}
      {children == null && <div style={{ height: 14 }} />}
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
          <span style={{ fontSize: 11.5, color: tFaint }}>{time}</span>
        </div>
        <div style={{ fontSize: 13.5, color: isDark ? '#e0e0e0' : '#1f1f1f', lineHeight: 1.65 }}>{children}</div>
        {quote && (
          <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`, fontSize: 11.5, color: tFaint, lineHeight: 1.5 }}>
            {quote}
          </div>
        )}
        {receipt && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '6px 0 0', fontSize: 11, color: tFaint }}>
            <CheckCheck size={12} style={{ color: '#1a73e8' }} /> {receipt}
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

// Gmail-style suggested replies.
export function SmartReplies({ isDark, accent, options, onPick, label = 'Suggested replies' }: {
  isDark: boolean; accent: string; options: string[]; onPick: (text: string) => void; label?: string;
}) {
  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6' }}>{label}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt, i) => (
          <button key={i} onClick={() => onPick(opt)}
            style={{
              padding: '7px 16px', borderRadius: 18, fontSize: 13, fontWeight: 600,
              border: `1px solid ${accent}55`, color: accent, background: 'transparent', cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${accent}12`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            {opt}
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
          <CornerUpLeft size={13} style={{ color: tFaint, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: tMuted }}>To:</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px 2px 3px', borderRadius: 14, background: isDark ? 'rgba(255,255,255,0.07)' : '#f1f3f4' }}>
            <PersonAvatar {...to} size={18} isDark={isDark} />
            <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#e8eaed' : '#202124' }}>{to.name}</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${line}` }}>
          <span style={{ fontSize: 12, color: tMuted, flexShrink: 0 }}>Subject:</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: isDark ? '#e8eaed' : '#202124', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
          <Send size={14} /> {sending ? 'Sending...' : sendLabel}
        </button>
        <Paperclip size={15} style={{ color: tFaint }} aria-hidden />
        <Smile size={15} style={{ color: tFaint }} aria-hidden />
        <span style={{ flex: 1 }} />
        {maxChars != null && (
          <span style={{ fontSize: 11, fontWeight: 600, color: overLimit ? '#ef4444' : plainLen >= maxChars * 0.96 ? '#ef4444' : tFaint }}>
            {plainLen} / {maxChars}
          </span>
        )}
        {onDiscard && (
          <button onClick={onDiscard} title="Discard draft"
            style={{ border: 'none', background: 'transparent', color: tFaint, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Trash2 size={15} />
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
      <CheckCheck size={14} /> {children}
    </div>
  );
}
