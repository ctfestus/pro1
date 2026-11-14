'use client';

import { useState } from 'react';
import { Check, ChevronDown, ListChecks } from 'lucide-react';
import type { Requirement } from '@/components/ve/requirements/types';

export interface TodoItem {
  id: string;
  label: string;
  /** Where the task lives: Email, Team chat, Deliverable, ... */
  source: string;
  done: boolean;
}

/** Plain name of the surface a requirement arrives on, as the learner sees it. */
export function todoSource(req: Requirement): string {
  if (req.type === 'briefing' || req.type === 'debrief' || req.emailFrame) return 'Email';
  if (req.type === 'scenario_update' || req.type === 'decision') return 'Team chat';
  switch (req.type) {
    case 'mcq': return 'Question';
    case 'text': return 'Short answer';
    case 'reflection': return 'Reflection';
    case 'upload': return 'Upload';
    case 'deliverable': return 'Deliverable';
    case 'linkedin_share': return 'LinkedIn';
    case 'dashboard_critique':
    case 'code_review':
    case 'excel_review':
    case 'document_review': return 'AI review';
    default: return 'Task';
  }
}

/** Scroll to a task and briefly ring it, so the learner sees where they landed. */
export function jumpToRequirement(reqId: string, accentColor: string) {
  const el = document.getElementById(`ve-req-${reqId}`);
  if (!el) return;
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  if (!calm) {
    el.animate?.(
      [{ boxShadow: `0 0 0 2px ${accentColor}` }, { boxShadow: `0 0 0 2px ${accentColor}00` }],
      { duration: 1600, easing: 'ease-out' },
    );
  }
}

function TodoList({ items, pendingCount, accentColor, text, faint, isDark, onJump }: {
  items: TodoItem[]; pendingCount: number; accentColor: string; text: string; faint: string; isDark: boolean;
  onJump: (id: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {items.map(item => (
        <button key={item.id} onClick={() => onJump(item.id)}
          className="flex items-start gap-2.5 text-left px-2 py-2 rounded-lg transition-colors"
          style={{ background: 'transparent' }}
          onMouseEnter={e => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          <span className="w-4 h-4 mt-0.5 rounded-[5px] flex items-center justify-center flex-shrink-0"
            style={item.done ? { background: accentColor, color: isDark ? '#111' : '#fff' } : { border: `1.5px solid ${faint}` }}>
            {item.done && <Check className="w-3 h-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] leading-snug" style={{ color: item.done ? faint : text, textDecoration: item.done ? 'line-through' : 'none' }}>
              {item.label}
            </span>
            <span className="block text-[11px]" style={{ color: faint }}>{item.source}</span>
          </span>
        </button>
      ))}
      {pendingCount > 0 && (
        <p className="text-[11.5px] px-2 pt-1.5" style={{ color: faint }}>
          {pendingCount === 1 ? '1 more on the way' : `${pendingCount} more on the way`}
        </p>
      )}
    </div>
  );
}

/**
 * What is still to do in this mission, from the tasks that have arrived so far. Wide screens get a
 * panel beside the mission (variant "rail"); narrower ones a pill that opens into the same list.
 */
export function MissionTodo({ variant, items, pendingCount, isDark, accentColor, text, muted, onJump }: {
  variant: 'rail' | 'pill';
  items: TodoItem[];
  pendingCount: number;
  isDark: boolean;
  accentColor: string;
  text: string;
  muted: string;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const faint = isDark ? '#777' : '#8a929e';
  const left = items.filter(i => !i.done).length;
  const surface = isDark ? '#1e1e1e' : '#ffffff';
  const summary = left === 0
    ? (pendingCount > 0 ? 'All caught up. More is on the way' : 'Everything in this mission is done')
    : left === 1 ? '1 thing to do in this mission' : `${left} things to do in this mission`;

  if (variant === 'rail') {
    return (
      <aside className="rounded-xl p-3" style={{ background: surface }} aria-label="To do in this mission">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] px-2 pt-1" style={{ color: faint }}>This mission</p>
        <h2 className="text-[15px] font-semibold px-2 pb-1.5" style={{ color: text, fontFamily: 'var(--font-display), sans-serif' }}>To do</h2>
        <TodoList items={items} pendingCount={pendingCount} accentColor={accentColor} text={text} faint={faint} isDark={isDark} onJump={onJump} />
      </aside>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: surface, boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.06)' : '0 4px 16px rgba(15,23,42,0.08)' }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left">
        <ListChecks className="w-4 h-4 flex-shrink-0" style={{ color: left ? accentColor : faint }} />
        {left > 0 && (
          <span className="text-[11px] font-bold rounded-full px-1.5 tabular-nums flex-shrink-0"
            style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>{left}</span>
        )}
        <span className="flex-1 min-w-0 truncate text-[13px] font-semibold" style={{ color: text }}>{summary}</span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 transition-transform" style={{ color: muted, transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="px-1.5 pb-2">
          <TodoList items={items} pendingCount={pendingCount} accentColor={accentColor} text={text} faint={faint} isDark={isDark}
            onJump={id => { setOpen(false); onJump(id); }} />
        </div>
      )}
    </div>
  );
}
