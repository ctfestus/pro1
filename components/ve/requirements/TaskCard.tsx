'use client';

import type React from 'react';
import { Check, Info, RotateCcw } from 'lucide-react';
import { onAccent } from '@/lib/ve-accent';

/**
 * The parts every plain task card in a virtual experience is built from (questions, written
 * answers, reflections, tasks, deliverables, uploads, AI reviews), so they all read as one design:
 * a small grey label with an icon, the title in the heading font, the instructions, the action,
 * and one green pill once it is done. Emails and team chat have their own surfaces and do not use
 * these.
 */

export interface TaskTheme {
  isDark: boolean;
  accent: string;
  text: string;
  muted: string;
  faint: string;
  /** Soft fill for fields, options and answer boxes. */
  soft: string;
  bad: string;
}

export function taskTheme(isDark: boolean, accent: string): TaskTheme {
  return {
    isDark,
    accent,
    text: isDark ? '#f0f0f0' : '#111111',
    muted: isDark ? '#9a9a9a' : '#5c6570',
    faint: isDark ? '#6f6f6f' : '#8a929e',
    soft: isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9',
    bad: isDark ? '#f0935f' : '#c2410c',
  };
}

export function TaskHeader({ t, icon, label, title, description, done }: {
  t: TaskTheme;
  icon: React.ReactNode;
  label: string;
  title: string;
  /** Plain-text instructions under the title. Rich instructions are rendered by the card itself. */
  description?: string;
  /** What happened, shown as a green pill once the task is done: "Correct", "Saved", "Reviewed 86 / 100". */
  done?: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: t.faint }}>
          {icon} {label}
        </span>
        <h3 className="mt-1 text-[16.5px] font-semibold leading-snug" style={{ color: t.text, fontFamily: 'var(--font-display), sans-serif', textWrap: 'balance' }}>
          {title}
        </h3>
        {description && <p className="mt-0.5 text-[13.5px] leading-relaxed" style={{ color: t.muted }}>{description}</p>}
      </div>
      {done && (
        <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap"
          style={{ background: `${t.accent}1a`, color: t.accent }} role="status">
          <Check className="w-3.5 h-3.5" strokeWidth={3} /> {done}
        </span>
      )}
    </div>
  );
}

/** The primary action of a task card. */
export function TaskButton({ t, onClick, disabled, children, type = 'button' }: {
  t: TaskTheme;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-bold whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed"
      style={{ background: t.accent, color: onAccent(t.accent) }}>
      {children}
    </button>
  );
}

/** A quiet text action under a done card: Undo, Replace. */
export function TaskLink({ t, onClick, children }: { t: TaskTheme; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[12.5px] font-semibold underline underline-offset-2 transition-opacity hover:opacity-70" style={{ color: t.muted }}>
      {children}
    </button>
  );
}

/** Undo a completed task: a small round icon button, labelled for hover and screen readers. */
export function TaskUndoButton({ t, onClick }: { t: TaskTheme; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Undo" aria-label="Undo"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-75"
      style={{ background: t.soft, color: t.muted }}>
      <RotateCcw className="w-4 h-4" />
    </button>
  );
}

/** One readable line in place of the long AI disclaimer, for cards that send work to AI review. */
export function AiNote({ t }: { t: TaskTheme }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] min-w-0" style={{ color: t.muted }}>
      <Info className="w-3.5 h-3.5 flex-shrink-0" /> AI feedback can be wrong. Double-check anything important.
    </span>
  );
}

/** Style for text inputs and text areas on a task card. */
/** Use with className TASK_FIELD (a single field) or TASK_SHELL (an icon plus a borderless input),
 * so focus shows on the rounded border in the accent instead of the browser's square outline. */
export const TASK_FIELD = 've-task-field';
export const TASK_SHELL = 've-task-shell';

export function fieldStyle(t: TaskTheme, state: 'normal' | 'bad' | 'done' = 'normal'): React.CSSProperties {
  return {
    ['--ve-focus' as string]: t.accent,
    ['--ve-focus-ring' as string]: `${t.accent}29`,
    background: t.soft,
    color: t.text,
    border: `1.5px solid ${state === 'bad' ? t.bad : state === 'done' ? `${t.accent}66` : 'transparent'}`,
    borderRadius: 10,
    outline: 'none',
    lineHeight: 1.6,
  };
}
