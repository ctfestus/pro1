'use client';

// Shared dashboard UI primitives, extracted verbatim from app/dashboard/page.tsx
// so sections can import them as they get split into their own files.
// No behavior or styling changes.

import { useState } from 'react';
import Link from 'next/link';
import { Send, Plus, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';

export type PushState = 'idle' | 'pushing' | 'done' | 'error';

// Shared sync-push state machine: drives both the kebab "Push" action and the
// thumbnail status pill. Fires POST /api/sync-push and auto-clears the result.
export function usePushStatus(type: string, id: string) {
  const [state, setState] = useState<PushState>('idle');
  const [msg, setMsg] = useState('');
  async function push() {
    setState('pushing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ type, id }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setMsg(result.action === 'updated' ? 'Updated' : 'Pushed');
      setState('done');
      setTimeout(() => setState('idle'), 2500);
    } catch (err: any) {
      // Failure messages come from the destination platform and are full sentences
      // ("Permission must be confirmed before publishing..."), so they need longer on
      // screen than a one-word success confirmation.
      setMsg(err.message || 'Push failed');
      setState('error');
      setTimeout(() => setState('idle'), 8000);
    }
  }
  return { state, msg, push };
}

// Status pill shown on a card thumbnail while/after a push. Renders nothing when idle.
//
// A failure carries the destination platform's own sentence (a consent block reads very
// differently from an unreachable server), so the error state widens into a wrapping,
// width-bounded block. Pushing and success stay the compact uppercase pill.
export function PushStatusPill({ state, msg, className = 'top-2 left-2' }: { state: PushState; msg: string; className?: string }) {
  if (state === 'idle') return null;
  const failed = state === 'error';
  const bg = failed ? 'rgba(239,68,68,0.95)' : state === 'done' ? 'rgba(16,185,129,0.95)' : 'rgba(17,17,17,0.72)';
  const shape = failed
    ? 'max-w-[min(15rem,calc(100%_-_1rem))] items-start rounded-xl px-2 py-1 text-left leading-snug'
    : 'items-center rounded-full px-2 py-0.5 uppercase tracking-wide whitespace-nowrap';
  return (
    <div role="status" aria-live="polite"
      className={`absolute z-10 flex gap-1 text-[11px] font-bold ${shape} ${className}`}
      style={{ background: bg, color: '#fff' }}>
      {state === 'pushing' && <Loader2 className="w-3 h-3 animate-spin shrink-0"/>}
      {failed ? (msg || 'Push failed') : state === 'done' ? msg : 'Pushing'}
    </div>
  );
}

export function PushButton({ type, id, C }: { type: string; id: string; C: typeof LIGHT_C }) {
  const [state, setState] = useState<'idle'|'pushing'|'done'|'error'>('idle');
  const [msg,   setMsg]   = useState('');

  async function push(e: React.MouseEvent) {
    e.stopPropagation();
    setState('pushing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/sync-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ type, id }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setMsg(result.action === 'updated' ? 'Updated' : 'Pushed');
      setState('done');
      setTimeout(() => setState('idle'), 2500);
    } catch (err: any) {
      setMsg(err.message || 'Push failed');
      setState('error');
      setTimeout(() => setState('idle'), 8000);
    }
  }

  const failed = state === 'error';
  const label = state === 'pushing' ? '...' : state === 'done' ? msg : failed ? (msg || 'Push failed') : 'Push';
  const color = state === 'done' ? C.green : failed ? C.deleteText : C.muted;
  // Idle is a hover hint and stays hover-only. Every other state is driven by the push
  // itself and must show without a pointer, or a touch operator never learns why a push
  // stopped. Failures also wrap inside a bounded width instead of running off-screen.
  const bubble = state === 'idle'
    ? 'whitespace-nowrap opacity-0 group-hover/push:opacity-100'
    : failed
      ? 'w-max max-w-[14rem] text-left leading-snug opacity-100'
      : 'whitespace-nowrap opacity-100';

  return (
    <div className="relative group/push">
      <button onClick={push} disabled={state === 'pushing'}
        className="p-2 rounded-lg transition-all hover:opacity-70 disabled:opacity-40"
        style={{ background: C.pill, color }}
        title="Push to other platform">
        <Send className="w-3.5 h-3.5" />
      </button>
      <span role={state === 'idle' ? undefined : 'status'} aria-live={state === 'idle' ? undefined : 'polite'}
        className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-0.5 rounded text-xs pointer-events-none transition-opacity z-20 ${bubble}`}
        style={{ background: C.text, color: C.page }}>
        {label}
      </span>
    </div>
  );
}

export function PushAllButton({ items, C, className, style }: {
  items: { type: string; id: string }[]; C: typeof LIGHT_C;
  /** The button's look on pages in the newer admin style. */
  className?: string; style?: React.CSSProperties;
}) {
  type PushAllState = { status: 'idle' } | { status: 'pushing'; current: number; total: number } | { status: 'done'; pushed: number; updated: number; failed: number };
  const [state, setState] = useState<PushAllState>({ status: 'idle' });

  async function pushAll() {
    if (!items.length) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    const summary = { pushed: 0, updated: 0, failed: 0 };
    setState({ status: 'pushing', current: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      setState({ status: 'pushing', current: i + 1, total: items.length });
      try {
        const res = await fetch('/api/sync-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(items[i]),
        });
        const result = await res.json();
        if (result.error) { summary.failed++; }
        else if (result.action === 'updated') { summary.updated++; }
        else { summary.pushed++; }
      } catch { summary.failed++; }
    }
    setState({ status: 'done', ...summary });
    setTimeout(() => setState({ status: 'idle' }), 3000);
  }

  const busy = state.status === 'pushing';
  const label = state.status === 'pushing'
    ? `${state.current}/${state.total}`
    : state.status === 'done'
    ? `+${state.pushed} ~${state.updated} x${state.failed}`
    : 'Push all';

  return (
    <button onClick={pushAll} disabled={busy || !items.length}
      className={className ?? 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40'}
      style={style ?? { background: C.card, color: state.status === 'done' ? C.green : C.muted }}>
      <Send className={style ? 'w-4 h-4' : 'w-3.5 h-3.5'} /> {label}
    </button>
  );
}

export function SectionEmptyState({ Icon, label, createHref, createLabel, C }: {
  Icon: React.ElementType; label: string; createHref: string; createLabel: string; C: typeof LIGHT_C;
}) {
  return (
    <div className="text-center py-24 rounded-3xl" style={{ ...cardStyle(C) }}>
      <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: C.lime }}>
        <Icon className="w-7 h-7" style={{ color: C.green }}/>
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: C.text }}>No {label} yet</h2>
      <p className="text-sm mb-5" style={{ color: C.faint }}>Create your first {label.toLowerCase()} to get started.</p>
      <Link href={createHref} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
        style={{ background: C.cta, color: C.ctaText }}>
        <Plus className="w-4 h-4"/> {createLabel}
      </Link>
    </div>
  );
}

export function StudentAvatar({ name, email, size = 32, C }: { name?: string; email?: string; size?: number; C: any }) {
  const label = (name || email || '?').slice(0, 2).toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
      style={{ width: size, height: size, background: C.lime, color: C.green }}>{label}</div>
  );
}
