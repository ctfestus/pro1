'use client';

// Session-only AI tutor for a lesson slide. The thread is intentionally rendered as a
// calm, full-width conversation: no avatars, chat bubbles, or alternating alignment.

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BrainCircuit,
  Lightbulb,
  ListTree,
  MessagesSquare,
  ShieldCheck,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Msg = { who: 'student' | 'tutor'; text: string };

const MAX_QUESTION_CHARS = 500;

const QUICK_ACTIONS = [
  { icon: Lightbulb, label: 'Explain simply', question: 'Explain this topic in simple terms' },
  { icon: ListTree, label: 'Summarize', question: 'Give me a summary' },
  { icon: BrainCircuit, label: 'Practice', question: 'Give me practice questions' },
  { icon: MessagesSquare, label: 'Real examples', question: 'Give me real-life examples' },
];

// One living point, colored by the course theme. The soft expanding signal gives it presence
// without turning it into a conventional AI logo.
export function TutorSignalMark({ accent, size = 20 }: { accent: string; size?: number }) {
  const pointSize = Math.max(7, Math.round(size * .46));
  const waveSize = Math.max(pointSize + 5, Math.round(size * .9));
  return (
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-grid', placeItems: 'center', width: size, height: size, flex: '0 0 auto' }}>
      <style>{`
        @keyframes tutorSignalPoint {
          0% { transform: scale(.68); opacity: .68; }
          70% { transform: scale(1.18); opacity: .18; }
          100% { transform: scale(1.45); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tutor-signal-wave { animation: none !important; opacity: .22 !important; }
        }
      `}</style>
      <span className="tutor-signal-wave" style={{ position: 'absolute', width: waveSize, height: waveSize, border: `1px solid ${accent}`, borderRadius: 99, background: `color-mix(in oklab, ${accent} 14%, transparent)`, animation: 'tutorSignalPoint 1.8s cubic-bezier(.2,.7,.3,1) infinite' }} />
      <span style={{ position: 'relative', width: pointSize, height: pointSize, borderRadius: 99, background: accent, boxShadow: `0 0 ${Math.max(8, size * .7)}px color-mix(in oklab, ${accent} 58%, transparent)` }} />
    </span>
  );
}

// Inline markdown: **bold** and `code`. It is converted to React nodes so model output
// can never inject markup into the page.
function inline(text: string, isDark: boolean): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={m.index} style={{ fontWeight: 680 }}>{m[1]}</strong>);
    } else {
      out.push(
        <code key={m.index} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em', padding: '2px 6px', borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.06)' }}>{m[2]}</code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function TutorMarkdown({ text, isDark }: { text: string; isDark: boolean }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={`p${blocks.length}`} style={{ margin: 0 }}>{inline(para.join(' '), isDark)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} style={{ margin: 0, paddingLeft: 22, listStyleType: ordered ? 'decimal' : 'disc', listStylePosition: 'outside' }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: 'list-item', marginTop: i ? 7 : 0, paddingLeft: 3 }}>{inline(it, isDark)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      blocks.push(<p key={`h${blocks.length}`} className="lesson-tutor-h">{inline(heading[1], isDark)}</p>);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((numbered ?? bullet)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="lesson-tutor-prose">{blocks}</div>;
}

export function LessonTutorPanel({ isDark, accent, courseId, slideId, open, onOpenChange }: {
  isDark: boolean;
  accent: string;
  courseId: string;
  slideId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMsgs([]);
    setInput('');
    setError('');
  }, [slideId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, waiting, open]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => { try { restoreRef.current?.focus(); } catch {} };
  }, [open]);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || waiting) return;
    setError('');
    setInput('');
    const history = msgs;
    setMsgs(prev => [...prev, { who: 'student', text: question }]);
    setWaiting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/lesson-tutor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ courseId, slideId, question, history }),
      });
      if (res.status === 401) throw new Error('Sign in to ask the tutor a question.');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setMsgs(prev => [...prev, { who: 'tutor', text: json.reply || '' }]);
    } catch (err: any) {
      setError(err.message || 'The tutor could not answer right now. Please try again.');
    } finally {
      setWaiting(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  if (!open) return null;

  const surface = isDark ? '#1E1F26' : '#ffffff';
  const elevated = isDark ? 'rgba(255,255,255,0.045)' : 'rgba(248,250,252,0.9)';
  const line = isDark ? 'rgba(255,255,255,0.085)' : 'rgba(15,23,42,0.075)';
  const text = isDark ? '#e7eaf0' : '#172033';
  const muted = isDark ? '#969dab' : '#687386';
  const faint = isDark ? '#707785' : '#929bab';

  return (
    <>
      <style>{`
        .lesson-tutor-pane { --tutor-accent: ${accent}; }
        @keyframes lessonTutorPulse {
          0%, 100% { opacity: .45; transform: scaleX(.32); }
          50% { opacity: 1; transform: scaleX(1); }
        }
        .lesson-tutor-close,
        .lesson-tutor-quick,
        .lesson-tutor-send { font: inherit; }
        .lesson-tutor-close:focus-visible,
        .lesson-tutor-quick:focus-visible,
        .lesson-tutor-input:focus-visible,
        .lesson-tutor-send:focus-visible {
          outline: 2px solid var(--tutor-accent);
          outline-offset: 2px;
        }
        .lesson-tutor-close {
          display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto;
          border: 1px solid ${line}; border-radius: 10px; color: ${muted};
          background: ${elevated}; cursor: pointer; transition: color .18s ease, border-color .18s ease, transform .18s ease;
        }
        .lesson-tutor-quick {
          display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 8px 11px;
          border: 1px solid ${line}; border-radius: 11px; color: ${muted};
          background: ${elevated}; font-size: .78rem; font-weight: 620; line-height: 1.25;
          text-align: left; cursor: pointer; transition: color .18s ease, border-color .18s ease, background .18s ease, transform .18s ease;
        }
        .lesson-tutor-quick svg { color: var(--tutor-accent); flex: 0 0 auto; }
        .lesson-tutor-turn { padding: 22px 0; border-top: 1px solid ${line}; }
        .lesson-tutor-turn:first-child { border-top: 0; padding-top: 4px; }
        .lesson-tutor-turn-student {
          display: flex; justify-content: flex-end; padding: 16px 0 10px; border-top: 0;
        }
        .lesson-tutor-turn-student + .lesson-tutor-turn-response {
          padding-top: 14px; border-top: 0;
        }
        .lesson-tutor-question {
          width: fit-content; max-width: 92%; margin: 0; padding: 11px 14px;
          border: none;
          border-radius: 16px 16px 5px 16px;
          background: color-mix(in oklab, var(--tutor-accent) ${isDark ? '16%' : '10%'}, ${surface});
          box-shadow: ${isDark ? 'inset 0 1px 0 rgba(255,255,255,.035)' : '0 6px 18px rgba(15,23,42,.045), inset 0 1px 0 rgba(255,255,255,.75)'};
          color: ${text}; font-size: .95rem; font-weight: 590; line-height: 1.55;
          letter-spacing: -.008em; text-wrap: pretty; overflow-wrap: anywhere;
        }
        .lesson-tutor-prose { display: flex; flex-direction: column; gap: 11px; color: ${text}; font-size: .925rem; line-height: 1.72; }
        .lesson-tutor-h { margin: 3px 0 0; color: ${text}; font-size: 1em; font-weight: 710; line-height: 1.45; }
        .lesson-tutor-composer {
          position: relative; border: 1px solid ${line}; border-radius: 16px; background: ${elevated};
          box-shadow: ${isDark ? 'inset 0 1px 0 rgba(255,255,255,.04)' : '0 8px 28px rgba(15,23,42,.055), inset 0 1px 0 rgba(255,255,255,.9)'};
          transition: border-color .18s ease, box-shadow .18s ease;
        }
        .lesson-tutor-composer:focus-within {
          border-color: color-mix(in oklab, var(--tutor-accent) 52%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--tutor-accent) 10%, transparent), ${isDark ? 'inset 0 1px 0 rgba(255,255,255,.04)' : '0 10px 30px rgba(15,23,42,.07)'};
        }
        .lesson-tutor-input {
          display: block; width: 100%; min-height: 50px; max-height: 130px; resize: none;
          padding: 14px 50px 12px 14px; border: 0; border-radius: inherit; background: transparent;
          color: ${text}; font: inherit; font-size: .875rem; line-height: 1.45; outline: none;
        }
        .lesson-tutor-input::placeholder { color: ${faint}; }
        .lesson-tutor-send {
          position: absolute; right: 8px; bottom: 8px; display: grid; place-items: center;
          width: 34px; height: 34px; border: 0; border-radius: 11px; color: #fff;
          background: var(--tutor-accent); box-shadow: 0 6px 18px color-mix(in oklab, var(--tutor-accent) 28%, transparent);
          cursor: pointer; transition: opacity .18s ease, transform .18s ease, box-shadow .18s ease;
        }
        .lesson-tutor-send:disabled { opacity: .3; cursor: default; box-shadow: none; }
        @media (hover: hover) {
          .lesson-tutor-close:hover { color: ${text}; border-color: color-mix(in oklab, var(--tutor-accent) 30%, transparent); transform: translateY(-1px); }
          .lesson-tutor-quick:hover { color: ${text}; border-color: color-mix(in oklab, var(--tutor-accent) 34%, transparent); background: color-mix(in oklab, var(--tutor-accent) 7%, ${surface}); transform: translateY(-1px); }
          .lesson-tutor-send:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 8px 22px color-mix(in oklab, var(--tutor-accent) 38%, transparent); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lesson-tutor-close, .lesson-tutor-quick, .lesson-tutor-send { transition: none; }
          .lesson-tutor-thinking { animation: none !important; transform: scaleX(1) !important; }
        }
      `}</style>

      <aside
        className="lesson-tutor-pane absolute inset-y-0 right-0 z-[56] rounded-l-2xl sm:relative sm:inset-auto sm:z-40 flex-shrink-0 flex flex-col sm:my-3 sm:mr-3 sm:rounded-2xl"
        role="complementary"
        aria-label="AI Assistant"
        onKeyDown={e => { if (e.key === 'Escape') onOpenChange(false); }}
        style={{
          width: 'min(100vw, 410px)',
          minWidth: 'min(100vw, 410px)',
          background: surface,
          color: text,
          overflow: 'hidden',
          border: isDark ? 'none' : `1px solid ${line}`,
          boxShadow: isDark
            ? '8px 12px 24px -16px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.025)'
            : '8px 12px 24px -16px rgba(15,23,42,.18)',
        } as React.CSSProperties}
      >
        <div style={{ position: 'relative', flexShrink: 0, padding: '16px 17px 14px', borderBottom: `1px solid ${line}`, overflow: 'hidden' }}>
          <div aria-hidden="true" style={{ position: 'absolute', width: 180, height: 100, right: -50, top: -58, borderRadius: '50%', background: accent, filter: 'blur(50px)', opacity: isDark ? .16 : .09 }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <TutorSignalMark accent={accent} size={17} />
                <p style={{ margin: 0, fontSize: '.91rem', fontWeight: 720, letterSpacing: '-.015em' }}>AI Assistant</p>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 2, padding: '3px 7px', borderRadius: 999, background: `color-mix(in oklab, ${accent} 10%, transparent)`, color: accent, fontSize: '.61rem', fontWeight: 750, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: accent, boxShadow: `0 0 8px ${accent}` }} />
                  Ready
                </span>
              </div>
            </div>
            <button onClick={() => onOpenChange(false)} className="lesson-tutor-close" title="Close tutor" aria-label="Close tutor">
              <X size={16} />
            </button>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '20px 18px 26px' }}>
          {msgs.length === 0 && !waiting && (
            <section aria-labelledby="lesson-tutor-welcome">
              <h2 id="lesson-tutor-welcome" style={{ margin: 0, color: text, fontSize: '1.24rem', lineHeight: 1.25, letterSpacing: '-.028em', fontWeight: 720 }}>
                What would you like to understand?
              </h2>
              <p style={{ margin: '9px 0 18px', color: muted, fontSize: '.84rem', lineHeight: 1.62 }}>
                Ask in your own words, or use a starting point. Answers stay focused on this lesson.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {QUICK_ACTIONS.map(action => {
                  const Icon = action.icon;
                  return (
                    <button key={action.label} onClick={() => ask(action.question)} className="lesson-tutor-quick">
                      <Icon size={15} aria-hidden="true" />
                      <span>{action.label}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 18, color: faint, fontSize: '.69rem', lineHeight: 1.45 }}>
                <ShieldCheck size={14} style={{ flex: '0 0 auto' }} aria-hidden="true" />
                <span>Grounded in the open lesson. Knowledge-check answers stay protected.</span>
              </div>
            </section>
          )}

          {msgs.map((msg, index) => (
            <article key={index} className={`lesson-tutor-turn ${msg.who === 'student' ? 'lesson-tutor-turn-student' : 'lesson-tutor-turn-response'}`}>
              {msg.who === 'student'
                ? <p className="lesson-tutor-question">{msg.text}</p>
                : <TutorMarkdown text={msg.text} isDark={isDark} />}
            </article>
          ))}

          {waiting && (
            <div role="status" aria-live="polite" style={{ padding: '22px 0 4px', borderTop: msgs.length > 0 ? `1px solid ${line}` : 'none' }}>
              <p style={{ margin: 0, color: muted, fontSize: '.84rem' }}>Thinking through the lesson...</p>
              <div style={{ width: 90, height: 2, marginTop: 12, overflow: 'hidden', borderRadius: 9, background: line }}>
                <div className="lesson-tutor-thinking" style={{ width: '100%', height: '100%', transformOrigin: 'left', background: accent, animation: 'lessonTutorPulse 1.15s ease-in-out infinite' }} />
              </div>
            </div>
          )}

          {error && <p role="alert" style={{ margin: '16px 0 0', padding: '10px 12px', border: '1px solid rgba(239,68,68,.22)', borderRadius: 10, background: 'rgba(239,68,68,.07)', color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '.78rem', lineHeight: 1.5 }}>{error}</p>}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '13px 14px 14px',
          borderTop: `1px solid ${isDark ? 'rgba(255,255,255,.07)' : line}`,
          background: isDark ? '#17181D' : '#f7f8fb',
          boxShadow: isDark ? 'inset 0 1px 0 rgba(255,255,255,.018)' : 'inset 0 1px 0 rgba(255,255,255,.8)',
        }}>
          <div className="lesson-tutor-composer">
            <textarea
              ref={inputRef}
              className="lesson-tutor-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              rows={1}
              maxLength={MAX_QUESTION_CHARS}
              autoFocus
              placeholder="Ask about this lesson..."
              aria-label="Ask about this lesson"
            />
            <button onClick={() => ask(input)} disabled={!input.trim() || waiting} className="lesson-tutor-send" title="Send" aria-label="Send question">
              <ArrowUp size={17} strokeWidth={2.4} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '8px 3px 0', color: faint, fontSize: '.64rem', lineHeight: 1.35 }}>
            <span>Enter to send, Shift + Enter for a new line</span>
            <span style={{ whiteSpace: 'nowrap' }}>Not saved</span>
          </div>
        </div>
      </aside>
    </>
  );
}
