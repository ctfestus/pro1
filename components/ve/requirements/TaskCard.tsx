'use client';

import type React from 'react';
import { Check, Info } from '@phosphor-icons/react';
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

export function TaskHeader({ t, icon, label, title, description, done, doneAction }: {
  t: TaskTheme;
  icon: React.ReactNode;
  label: string;
  title: string;
  /** Plain-text instructions under the title. Rich instructions are rendered by the card itself. */
  description?: string;
  /** What happened, shown as a green pill once the task is done: "Correct", "Saved", "Reviewed 86 / 100". */
  done?: string | null;
  /** A secondary action shown beside the done pill, so it reads as acting on it: Undo, Edit. */
  doneAction?: React.ReactNode;
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
        <span className="flex flex-shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap"
            style={{ background: `${t.accent}1a`, color: t.accent }} role="status">
            <Check weight="bold" className="w-3.5 h-3.5" /> {done}
          </span>
          {doneAction}
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
    // Not ready yet reads as grey, not as a washed-out version of the live button.
    <button type={type} onClick={onClick} disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-bold whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-100 disabled:cursor-not-allowed"
      style={disabled ? { background: t.soft, color: t.faint } : { background: t.accent, color: onAccent(t.accent) }}>
      {children}
    </button>
  );
}

/** A secondary action on a done card (Undo, Edit, Replace): a round icon button with a name for
 * hover and screen readers. The tap area is 44px; the visible circle is 32px. */
export function TaskIconButton({ t, label, icon, onClick }: { t: TaskTheme; label: string; icon: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full -m-1.5 transition-opacity hover:opacity-75">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ background: t.soft, color: t.muted }}>{icon}</span>
    </button>
  );
}

/**
 * One answer option: a lettered chip, the text, and a note when the pick missed. Used by the
 * question card, a question sent as an email, and a decision in team chat, so a choice looks and
 * behaves the same wherever it arrives.
 */
export function TaskOption({ t, letter, children, state = 'idle', note, onClick, disabled, role, checked }: {
  t: TaskTheme;
  letter: string;
  children: React.ReactNode;
  /** idle: can be picked. right: the correct pick. missed: a wrong pick. faded: the others once answered. */
  state?: 'idle' | 'right' | 'missed' | 'faded';
  note?: string;
  onClick?: () => void;
  disabled?: boolean;
  role?: 'radio';
  checked?: boolean;
}) {
  const right = state === 'right';
  const missed = state === 'missed';
  return (
    <button type="button" role={role} aria-checked={role ? !!checked : undefined} onClick={onClick} disabled={disabled}
      className="w-full flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[14px] transition-colors disabled:cursor-default"
      style={{
        background: right ? `${t.accent}1a` : missed ? `${t.bad}14` : t.soft,
        color: t.text,
        opacity: state === 'faded' ? 0.55 : 1,
      }}>
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] text-[12px] font-bold"
        style={{
          background: right ? t.accent : t.isDark ? 'rgba(255,255,255,0.08)' : '#ffffff',
          color: right ? onAccent(t.accent) : missed ? t.bad : t.muted,
        }}>
        {letter}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
      {missed && note && <span className="flex-shrink-0 text-[12.5px] font-semibold" style={{ color: t.bad }}>{note}</span>}
    </button>
  );
}

/** One readable line in place of the long AI disclaimer, for cards that send work to AI review. */
export function AiNote({ t }: { t: TaskTheme }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] min-w-0" style={{ color: t.muted }}>
      <Info weight="duotone" className="w-3.5 h-3.5 flex-shrink-0" /> AI feedback can be wrong. Double-check anything important.
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
