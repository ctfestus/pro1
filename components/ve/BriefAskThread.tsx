'use client';

// Session-only clarification chat for manager briefs, shown as a floating
// side-chat window (like a workplace chat popup) launched from the brief's
// mail toolbar. The AI answers in the manager's persona via /api/ve-brief-chat,
// which loads all context (brief, background, project plan, persona) server-side
// from the VE row -- the client only sends which brief is being asked about.
// Nothing is persisted anywhere -- the thread lives in component state and is
// gone when the player unmounts. That is the intended behavior, not a gap.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Person, PersonAvatar, TypingDots, WorkplaceKeyframes, firstNameOf } from './workplace';

type Msg = { who: 'me' | 'manager'; text: string };

// Manager replies arrive as plain text with blank-line paragraphs, "- " or "1. " list lines, and
// occasional **bold**. Rendered through React only (no raw HTML), so there is no injection surface.
function renderBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>);
}

const BULLET = /^[-*]\s+/;
const NUMBERED = /^\d+[.)]\s+/;

function ReplyText({ text }: { text: string }) {
  // Runs of list lines become one list; any other run of lines is a paragraph. A blank line also
  // ends a paragraph, so a reply that forgets blank lines around a list still gets spacing.
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]) { i++; continue; }
    const kind = BULLET.test(lines[i]) ? 'ul' : NUMBERED.test(lines[i]) ? 'ol' : 'p';
    const run: string[] = [];
    if (kind === 'p') {
      while (i < lines.length && lines[i] && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) run.push(lines[i++]);
      blocks.push(
        <p key={blocks.length} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {run.map((l, j) => <React.Fragment key={j}>{renderBold(l)}{j < run.length - 1 ? '\n' : ''}</React.Fragment>)}
        </p>);
    } else {
      const re = kind === 'ul' ? BULLET : NUMBERED;
      while (i < lines.length && re.test(lines[i])) run.push(lines[i++].replace(re, ''));
      const ListTag = kind;
      blocks.push(
        <ListTag key={blocks.length} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, listStyleType: kind === 'ul' ? 'disc' : 'decimal' }}>
          {run.map((l, j) => <li key={j}>{renderBold(l)}</li>)}
        </ListTag>);
    }
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{blocks}</div>;
}

export function BriefAskThread({ isDark, accent, manager, studentName, veId, reqId, open, onOpenChange }: {
  isDark: boolean;
  accent: string;
  manager: Person;
  studentName: string;
  veId: string;                           // virtual_experiences row id -- server loads context from it
  reqId: string;                          // the briefing requirement being asked about
  open: boolean;                          // lifted so the mail toolbar's chat pill drives the panel
  onOpenChange: (open: boolean) => void;
}) {
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [input, setInput]     = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError]     = useState('');
  const scrollRef  = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, waiting, open]);

  // Return focus to whatever launched the panel once it closes.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => { try { restoreRef.current?.focus(); } catch {} };
  }, [open]);

  const send = async () => {
    const question = input.trim();
    if (!question || waiting) return;
    setError('');
    setInput('');
    const history = msgs;
    setMsgs(prev => [...prev, { who: 'me', text: question }]);
    setWaiting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ve-brief-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ veId, reqId, question, history, studentName }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setMsgs(prev => [...prev, { who: 'manager', text: json.reply || '' }]);
    } catch (err: any) {
      setError(err.message || 'Could not send your question right now. Please try again.');
    } finally {
      setWaiting(false);
    }
  };

  if (!open) return null;

  const winBg  = isDark ? '#1b1c20' : '#ffffff';
  const barBg  = isDark ? '#202127' : '#f6f8fc';
  const line   = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tText  = isDark ? '#e8eaed' : '#202124';
  const tFaint = isDark ? '#6b7075' : '#9aa0a6';

  const managerBubble = (children: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', maxWidth: '90%', alignItems: 'flex-end' }}>
      <PersonAvatar {...manager} size={24} isDark={isDark} />
      <div style={{ padding: '8px 12px', borderRadius: '14px 14px 14px 4px', background: isDark ? '#26272c' : '#f1f3f4', color: tText, fontSize: 13.5, lineHeight: 1.55, wordBreak: 'break-word' }}>
        {children}
      </div>
    </div>
  );

  const panel = (
    <div role="dialog" aria-label={`Chat with ${manager.name}`}
      onKeyDown={e => { if (e.key === 'Escape') onOpenChange(false); }}
      style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 90, width: 'min(380px, calc(100vw - 28px))', height: 'min(480px, calc(100vh - 90px))', display: 'flex', flexDirection: 'column', background: winBg, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 16, boxShadow: '0 16px 48px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
      <WorkplaceKeyframes />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: barBg, borderBottom: `1px solid ${line}` }}>
        <PersonAvatar {...manager} size={32} presence="active" isDark={isDark} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: tText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{manager.name}</p>
          <p style={{ margin: 0, fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Active now</p>
        </div>
        <button onClick={() => onOpenChange(false)} title="Close chat" aria-label="Close chat"
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: 'none', background: 'transparent', color: tFaint, cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.length === 0 && managerBubble(
          `Hi ${firstNameOf(studentName) || 'there'}, what can I clarify about the brief or the tasks?`
        )}
        {msgs.map((m, i) => (
          m.who === 'me' ? (
            <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: accent, color: '#fff', fontSize: 13.5, lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {m.text}
            </div>
          ) : (
            <React.Fragment key={i}>{managerBubble(<ReplyText text={m.text} />)}</React.Fragment>
          )
        ))}
        {waiting && managerBubble(<TypingDots isDark={isDark} />)}
        {error && <p style={{ margin: 0, fontSize: 12, color: '#ef4444' }}>{error}</p>}
      </div>

      {/* Composer */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            maxLength={500}
            autoFocus
            placeholder={`Message ${firstNameOf(manager.name)}...`}
            style={{ flex: 1, padding: '9px 14px', borderRadius: 18, border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`, background: isDark ? 'rgba(255,255,255,0.055)' : '#fff', boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)', color: tText, fontSize: 13.5, outline: 'none' }} />
          <button onClick={send} disabled={!input.trim() || waiting} title="Send" aria-label="Send"
            style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: 'none', background: input.trim() && !waiting ? accent : (isDark ? '#333' : '#e0e0e0'), color: input.trim() && !waiting ? '#fff' : (isDark ? '#666' : '#aaa'), cursor: input.trim() && !waiting ? 'pointer' : 'not-allowed' }}>
            <Send size={14} />
          </button>
        </div>
        <p style={{ margin: '6px 2px 0', fontSize: 10.5, color: tFaint }}>
          Quick clarifications only. Not saved - this chat clears when you leave.
        </p>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
