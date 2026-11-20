'use client';

// Date and time fields drawn by us instead of the browser's date box: a field that opens a month
// calendar, and a short time menu. Values stay the strings the native inputs used
// ("YYYY-MM-DD", "HH:mm", "YYYY-MM-DDTHH:mm"), so callers change nothing else.
// Works with either theme (lib/theme or the create editor's own): it only needs these colours.

import { useEffect, useRef, useState, type CSSProperties, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';

export type PickerColors = {
  text: string; muted: string; faint: string; card: string; cardBorder: string;
  divider: string; pill: string; input: string; inputBorder: string;
};

// The chosen day and time, in the same blue as the dropdown ticks (MenuSelect).
const PICKED = '#3E93FF';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`).concat('23:59');
const POPOVER_SHADOW = '0 16px 40px rgba(15,23,42,0.18)';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** Today as "YYYY-MM-DD", on the viewer's clock or in UTC. */
function todayKey(utc: boolean) {
  const now = new Date();
  return utc ? now.toISOString().slice(0, 10) : ymd(now.getFullYear(), now.getMonth(), now.getDate());
}

/** "30 Nov 2026" from "2026-11-30", read as a calendar date with no time zone. */
export function formatDateKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fieldStyle(C: PickerColors, open: boolean): CSSProperties {
  return { background: C.input, color: C.text, border: `1px solid ${open ? C.faint : C.inputBorder}` };
}

/**
 * Where a pop-up sits: fixed to the window and drawn on top of everything, so a pop-up or card
 * that hides its overflow cannot cut it off. Below its field, or above when there is no room.
 */
function popoverPosition(field: HTMLElement, width: number, height: number, alignRight: boolean): CSSProperties {
  const rect = field.getBoundingClientRect();
  const left = Math.min(Math.max(8, alignRight ? rect.right - width : rect.left), window.innerWidth - width - 8);
  const up = window.innerHeight - rect.bottom < height + 16 && rect.top > height + 16;
  return up ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 8 } : { position: 'fixed', left, top: rect.bottom + 8 };
}

/** Open and close a pop-up drawn in a portal: closes on Escape, on focus leaving, and on scroll. */
function usePopover() {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const size = useRef({ width: 0, height: 0, alignRight: false });
  const close = () => setPosition(null);
  const open = Boolean(position);
  useEffect(() => {
    if (!open) return;
    // Fixed to the window, so it follows its field when the page or a pop-up behind it scrolls.
    const follow = (event: Event) => {
      const field = fieldRef.current;
      const target = event.target;
      // A resize comes from the window; a scroll counts only when it moves the field.
      if (!field || (target instanceof Element && !target.contains(field))) return;
      const { width, height, alignRight } = size.current;
      setPosition(popoverPosition(field, width, height, alignRight));
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [open]);
  // The pop-up lives outside the field in the page, so focus moving into it is not leaving.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!fieldRef.current?.contains(next) && !popRef.current?.contains(next)) close();
  };
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && position) { e.stopPropagation(); close(); } };
  const toggle = (width: number, height: number, alignRight = false) => {
    if (position) close();
    else if (fieldRef.current) {
      size.current = { width, height, alignRight };
      setPosition(popoverPosition(fieldRef.current, width, height, alignRight));
    }
  };
  return { open, position, fieldRef, popRef, onBlur, onKeyDown, toggle, close };
}

export function DateField({ value, onChange, label, placeholder = 'Choose a date', min, max, disabled = false, clearable = true, utc = false, compact = false, className = '', C }: {
  /** "YYYY-MM-DD", or empty. */
  value: string;
  onChange: (value: string) => void;
  /** What the field is for, for screen readers. */
  label: string;
  /** Shown when empty, and on the calendar's clear button. */
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Whether the date can be removed again. */
  clearable?: boolean;
  /** Count "today" in UTC instead of on the viewer's clock. */
  utc?: boolean;
  compact?: boolean;
  className?: string;
  C: PickerColors;
}) {
  const { open, position, fieldRef, popRef, onBlur, onKeyDown, toggle, close } = usePopover();
  const today = todayKey(utc);
  const [view, setView] = useState(() => {
    const [y, m] = (value || today).split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const first = new Date(Date.UTC(view.year, view.month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const allowed = (key: string) => (!min || key >= min) && (!max || key <= max);
  const move = (step: number) => setView(({ year, month }) => {
    const next = new Date(Date.UTC(year, month + step, 1));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
  });
  const pick = (key: string) => { onChange(key); close(); };

  return (
    <div className={`relative ${className}`} ref={fieldRef} onBlur={onBlur} onKeyDown={onKeyDown}>
      <div className={`flex items-center rounded-[10px] ${compact ? 'h-9' : 'h-11'} ${disabled ? 'opacity-50' : ''}`} style={fieldStyle(C, open)}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!open) {
              const [y, m] = (value || today).split('-').map(Number);
              setView({ year: y, month: m - 1 });
            }
            toggle(288, 340);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${value ? formatDateKey(value) : placeholder}`}
          className="flex-1 min-w-0 h-full flex items-center gap-2 px-3 text-left text-sm outline-none disabled:cursor-not-allowed"
        >
          <CalendarDays className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }} />
          <span className="truncate" style={{ color: value ? C.text : C.faint, fontWeight: value ? 500 : 400 }}>
            {value ? formatDateKey(value) : placeholder}
          </span>
        </button>
        {clearable && value && !disabled && (
          <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label.toLowerCase()}`} className="w-8 h-8 mr-1 grid place-items-center rounded-lg flex-shrink-0" style={{ color: C.faint }}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
          className="z-[1000] w-72 rounded-2xl p-3"
          style={{ ...position, background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: POPOVER_SHADOW }}
        >
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => move(-1)} aria-label="Previous month" className="w-8 h-8 grid place-items-center rounded-lg" style={{ color: C.muted }}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <b className="text-sm font-semibold" style={{ color: C.text }}>{MONTHS[view.month]} {view.year}</b>
            <button type="button" onClick={() => move(1)} aria-label="Next month" className="w-8 h-8 grid place-items-center rounded-lg" style={{ color: C.muted }}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
              <span key={d} className="text-[11px] font-semibold py-1" style={{ color: C.faint }}>{d}</span>
            ))}
            {cells.map((day, i) => {
              if (!day) return <span key={`e${i}`} />;
              const key = ymd(view.year, view.month, day);
              const selected = key === value;
              const ok = allowed(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!ok}
                  onClick={() => pick(key)}
                  aria-pressed={selected}
                  aria-label={formatDateKey(key)}
                  className="h-8 rounded-lg text-xs tabular-nums transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: selected ? PICKED : 'transparent',
                    color: selected ? '#FFFFFF' : C.text,
                    fontWeight: selected ? 700 : 400,
                    boxShadow: key === today && !selected ? `inset 0 0 0 1px ${C.faint}` : 'none',
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${C.divider}` }}>
            {clearable
              ? <button type="button" onClick={() => { onChange(''); close(); }} className="text-xs font-semibold" style={{ color: C.text }}>{placeholder === 'Choose a date' ? 'Clear' : placeholder}</button>
              : <span />}
            <button type="button" disabled={!allowed(today)} onClick={() => pick(today)} className="text-xs font-semibold disabled:opacity-40" style={{ color: C.text }}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function TimeField({ value, onChange, label, placeholder = 'Time', disabled = false, compact = false, className = '', C }: {
  /** "HH:mm", or empty. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  C: PickerColors;
}) {
  const { open, position, fieldRef, popRef, onBlur, onKeyDown, toggle, close } = usePopover();
  // A saved time off the half hour still appears, so opening the menu never loses it.
  const options = !value || TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return (
    <div className={`relative ${className}`} ref={fieldRef} onBlur={onBlur} onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${value || placeholder}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => toggle(128, 248, true)}
        className={`w-full ${compact ? 'h-9' : 'h-11'} flex items-center gap-2 px-3 rounded-[10px] text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
        style={fieldStyle(C, open)}
      >
        <Clock3 className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }} />
        <span className="flex-1 text-left tabular-nums" style={{ color: value ? C.text : C.faint }}>{value || placeholder}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.faint }} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          role="listbox"
          aria-label={label}
          className="z-[1000] w-32 max-h-60 overflow-y-auto rounded-2xl p-1"
          style={{ ...position, background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: POPOVER_SHADOW }}
        >
          {options.map((t) => {
            const selected = t === value;
            return (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={selected}
                // Scroll only the list, never the page or pop-up behind it (that would close this list).
                ref={selected ? (el) => { const list = el?.parentElement; if (el && list) list.scrollTop = el.offsetTop - list.clientHeight / 2; } : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(t); close(); }}
                className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm tabular-nums"
                style={{ background: selected ? C.pill : 'transparent', color: C.text, fontWeight: selected ? 600 : 400 }}
              >
                {t}
                {selected && <Check className="w-4 h-4" style={{ color: PICKED }} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A date and a time together, held as "YYYY-MM-DDTHH:mm" (what datetime-local used). */
export function DateTimeField({ value, onChange, label, placeholder, defaultTime = '09:00', utc = false, disabled = false, compact = false, C }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Shown when there is no date, such as "No end date". */
  placeholder?: string;
  /** The time a newly picked date starts with. */
  defaultTime?: string;
  utc?: boolean;
  disabled?: boolean;
  compact?: boolean;
  C: PickerColors;
}) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || defaultTime;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
      <DateField
        value={date}
        onChange={(d) => onChange(d ? `${d}T${time}` : '')}
        label={label}
        placeholder={placeholder}
        utc={utc}
        disabled={disabled}
        compact={compact}
        C={C}
      />
      <TimeField value={date ? time : ''} onChange={(t) => onChange(`${date}T${t}`)} label={`${label} time`} disabled={disabled || !date} compact={compact} C={C} />
    </div>
  );
}
